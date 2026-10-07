# Heimat's money engine

How Heimat turns expenses and payments into who owes whom — and why every
rule is the way it is. Written so that someone new (or a new chat with an AI
assistant) can pick it up without the history.

## One engine, three implementations

| Where | File | Used for |
| --- | --- | --- |
| Web app (React) | `src/lib/ledger.ts` | the reference; previews and every figure on screen |
| iOS app (SwiftUI) | `ios-native/Heimat/Ledger.swift` | the same, line for line |
| Database (Postgres) | `supabase/migrations/20260925000000_engine_v2.sql` (+ `…030000_ledger_cents.sql`, `…040000_flat_balance_members_only.sql`) | the stored shares that count, `flat_balance()` for Remind/Remove, push notifications, recurring expenses |

They are held to identical answers by one set of test vectors:

- `tests/ledger-vectors.json` — generated from the TypeScript by `npm run vectors` (`tests/make-vectors.ts`). Never edit by hand.
- `npm test` — runs `tests/ledger.test.ts` (property tests over thousands of random flats, brute-force check of the settle-up optimum) **and** `scripts/test-ledger-swift.sh` (compiles `Ledger.swift` with plain `swiftc` and checks it against the vectors, ~1,150 checks + ~16,000 properties).
- `supabase/tests/ledger_vectors.sql` and `supabase/tests/engine_v2_vectors.sql` — read-only checks of the installed database functions against the vectors; run after any migration that touches them.
- `supabase/tests/rehearse_engine_v2.py` — a full rehearsal of the migration against the real database, rolled back (see "Testing the database").

**Change a rule in one place → change all three → `npm run vectors` → `npm test` → re-run the SQL check.**

## The rules

### Money is whole minor units, never binary fractions
Every amount is an integer count of the currency's smallest unit (cents for EUR; ISO 4217 exponents — 0 for JPY/KRW/VND…, 3 for KWD/BHD…, same table in all three). `toMinor` rounds what the number *says* in decimal (shifts the point in its shortest decimal form), half away from zero. Postgres uses `numeric` and `power(10::numeric, …)` — never `10 ^ n`, which is a double.

### Splitting one expense
`computeShares(total, spec, seed)` / `split_shares()` always returns whole units adding up to **exactly** the total, or a structured error (`empty`, `too_large`, `bad_value`, `sum_mismatch`, `percent_total`, `remainder_negative`, `not_in_split`, `unknown_type`).

| Type | Input (`expenses.split`) | Rule |
| --- | --- | --- |
| `equal` | `split_among` | everyone equal |
| `exact` | `values`: minor units per person | must add up to the bill |
| `percent` | `values`: basis points (10000 = 100 %) | must be exactly 100 % |
| `shares` | `values`: weights, ≤ 2 decimals | proportional |
| `adjust` | `split_among` + `values`: ± minor units | adjustments first, the rest split equally among `split_among` (Splitwise "split by adjustment") |
| `itemized` | `items` [{minor, among}], `tax`, `tip`, `discount` | each item split equally among who had it; tax + tip − discount spread in proportion to each person's items |

Every adjustment, receipt line, tax, tip and discount is capped like the bill itself (10¹¹ minor units → `bad_value`), so no share can outgrow the integers a phone computes exactly. A JSON `null` for `values` or an item's `among` reads as missing.

All of them use one allocator: **largest remainder (Hamilton)** with weights. Leftover cents go to the largest remainders; ties go to whoever sorts first by `fnv1a(seed + ':' + userId)` (32-bit FNV-1a over UTF-8), then by id (UTF-16/byte order). The seed is the expense id, so:
- the odd cent rotates between people from one expense to the next (fair; "payer always pays it" drifted real balances by up to 18 ¢),
- the same expense always splits the same way on every device, and re-saving never moves it (Splitwise re-randomises on save).

New expenses get their id on the device (lowercased — Postgres returns uuids lowercase), so the split previewed is the split saved.

### Several payers
`payers` = minor units per person, must add up to the bill; `paid_by` must be one of them (older apps read it). No `payers` → `paid_by` paid it all.

### Stored shares are the record
On every insert/update of the money columns (amount, currency, paid_by, split_among, split_type, split, payers), the database trigger `expense_postings()` computes and stores `expenses.shares` (who owes what, in minor units, non-zero entries only). Balances are sums of stored shares and payments, so a later change of rules never re-splits an old bill. The apps use stored shares when they add up, else compute (rows from before, previews).

On the way in the trigger also: fills a missing currency with the flat's (and upper-cases it; `expenses.currency` must be an ISO code), writes every person-id in `split`/`payers` in canonical lower-case uuid form, stores payers as whole numbers (5000.0 → 5000), clears `split` on equal splits, and refuses (`split: not_in_flat`) anyone *newly* named — paid_by, payers, or a share — who isn't a current member or pending invitee of the flat. People already on an expense may have left; the old expense stays editable.

### Who owes whom
Per expense, everyone "down" (paid less than their share) owes the people "up", in proportion to how far up each is; debtors in id order, each split over what creditors are still owed — so the per-pair figures add up to each balance exactly. With one payer: everyone owes the payer their share. Across expenses the pairs are netted per pair only. The group page shows these pairwise figures unless the group has **simplify debts** on (below).

### Settle up and simplify debts
`settlePlan` (TS) / `Ledger.plan` (Swift) / `settle_plan()` (SQL, migration `20261008010000_simplify_debts.sql`) give the fewest payments that bring every balance to zero. The three are held to the same answers by `tests/ledger-vectors.json` (104 plan cases) and, for SQL, by a fingerprint over 400 generated books.
- **Fewest payments, proven up to 14 people with money outstanding.** A plan needs (people − groups) payments for the most groups the balances split into that each sum to zero (Verhoeff 2004; NP-hard in general). An O(n·2ⁿ) DP finds that split: best[m] = max over i of best[m∖i] + [m sums to 0], walked back taking the lowest index that keeps the count. Beyond 14: never more than people − 1.
- **Inside each group: the north-west corner.** Debtors and creditors each in id order, each payment what is left of one against what is left of the other. A group from the DP has no smaller zero-sum group inside it, so this always takes exactly (size − 1) payments. It is also *stable*: paying a suggestion, in full or in part, only closes up that payment's gap, so the other suggestions in its group stay as they were (the old largest-to-largest greedy re-paired everyone after each payment). Across groups a payment can flip a tie between two people who now owe the same — measured: the rest of the plan stays identical after ~99% of full payments, and a payment never makes the rest need more payments.
- **Guarantees** (property tests in `tests/ledger.test.ts`, Swift checks in `ios-native/Tests/LedgerTests.swift`): everyone ends at exactly zero; each debtor pays exactly what they owe overall; nobody both pays and receives, so the least money moves; the same plan however the balances arrive; books that don't balance, or add up beyond 2^53 minor units, get no plan rather than a wrong one.
- **Not promised** (and not true in general): paying only people you owed, or paying only one person — A −10, B −10, C +7, D +13 needs three payments.

**Simplify debts** is a per-group switch (`flats.simplify_debts`, `set_simplify_debts(flat, on)`; anyone in the group, logged as `simplify_on/off` in activity, refused for non-group circles, and it touches the caller's `flat_members` row so open apps reload). It is only a view: `simplifyLedger` / `Ledger.simplified` replace each currency book's who-owes-whom with the plan and leave every balance as it was; expenses and payments are never rewritten. With it on, everything that shows who owes whom uses the plan — group balances, All balances, the person page and paying one person (`spread`), Home's totals, Settle up's suggestions, MoneyTrack's `my_pairwise()`, and reminders (`nudge` now needs the person to owe *you* ≥ 0,50 € as shown — pairwise or planned — and says that amount, not their whole balance). With it off, Settle up suggests what each person actually owes, pair by pair. Turning it off after paying by the plan can show people owing each other in a circle; totals stay right (Splitwise behaves the same).

### Currencies
Each expense and settlement has a currency (`settlements.currency` null or '' = the flat's currency). Each currency keeps its own book; nothing is ever added across currencies as bare numbers. The flat's main currency is the one most of its *live* expenses use (deleted ones don't count — the apps can't see them); a flat with no expenses takes the currency most of its payments were recorded in, then the app's home currency. `convertNet(books, target, rates)` shows everything in one currency using exact decimal-string rates and largest-remainder rounding (still sums to zero) — for display only; history is never rewritten (Splitwise Pro rewrites it). Exchange rates are stored to 6 significant digits, shown to 4.

### Recurring expenses
`recurring_expenses` templates: cadence weekly / biweekly / monthly / quarterly / yearly, `anchor_on`, `next_n`, optional `until_on`. Occurrence n is always counted from the anchor (month-end clamped: 31 Jan → 28/29 Feb → 31 Mar; 29 Feb yearly → 28 Feb).
- Checked when saved (`recurring_check`): the same split/payer rules as an expense, everyone in it a current member, first date at most a year back (it catches up on every date since), at most 50 active per flat. Apps can't set `next_n`, `created_by`, or change `anchor_on`/`cadence` afterwards (column grants) — a new schedule is a new template.
- Anyone in the flat may edit one; whoever last changed what it adds becomes its author, and the feed shows `recurring_added / edited / paused / resumed / deleted / stopped`. Resuming carries on from today — it doesn't bill the paused time.
- Occurrences are numbered (`expenses.recurring_n`, server-owned), so moving one to another day never makes the generator skip or double it. A template stopped by the generator (`stopped = member_left / error`) catches up on the occurrences it held back when resumed (back to a year); one paused by someone (`stopped = paused`) carries on from today.
- `generate_recurring()` runs at :05 every hour from 06:05 to 21:05 UTC (pg_cron `heimat-recurring`; 08:05–23:05 German summer time), so what falls due today is added in the morning. It catches up missed dates (at most 60 per template and 2000 in all per run; the rest next run), is idempotent (unique `(recurring_id, spent_on)`), pauses a template whose split breaks, and stops one when anyone in it is no longer a current member (left, or deleted their account). Only an occurrence dated today sends a push; catch-up ones are in the feed only.

### Deleting and restoring
`delete_expense(id)` keeps the row with `deleted_at` (hidden by RLS), `restore_expense(id)` brings it back, `deleted_expenses(flat)` lists them; both logged in activity. Realtime can't deliver a change to a row the reader may no longer see, so `delete_expense` also touches the caller's `flat_members` row, which every open app listens to and reloads on. Apps from before (Build 8) still hard-delete.

### People joining and leaving
- Taking over an invite (`claim_member`, via `claim_invite`, `claim_invites` or signing up with the invited email) moves *everything* recorded under the placeholder id to the real account in one statement per row: paid_by, split_among, payers, the split's values and items, recurring templates, the flat's default split, payments and list items. When the real account is already in the flat the two are merged (amounts added), and someone who had left and is invited back is back. Each claim is isolated — one that fails doesn't undo the others.
- Taking over keeps the stored figures cent for cent (the shares are renamed, not re-split — for every split type, equal and adjusted ones included, since `20261002020000_claim_keeps_cents.sql`; before, the odd cent of an equal split could move to someone else because the new account id sorts differently), and is invisible in the feed except for "joined". Only a merge — the account already on the same expense — is worked out again.
- Withdrawing an invite (`forget_member`) takes the invitee out of equal splits and clears away already-deleted expenses that name them; it is refused while they paid for a live expense, are in a live split by amounts/percentages/shares/items, are the only one in an expense several people paid, or are in a recurring expense — there is no neutral answer for those. **Declining always works** for the invitee: when those rules refuse, they stay in the books as someone who has left and the invite dies.
- Someone with money in the flat (as payer, co-payer, in a stored share, or in a recurring expense — `has_history`) is marked as left rather than deleted. An invite removed that way is dead (its token is cleared and it can't be taken over), and a default split naming a departing person is cleared.
- Someone who left comes back with the flat's code (`join_flat`) or by being invited again (`invite_member` re-activates the account's row, or re-sends a fresh invite to an address that never signed up).
- `remove_member` requires the person to be square in **every** currency the flat uses; its message names the currency ("down 15.00 CHF").
- A new equal split never includes someone who has left (Build 8's Siri shortcut lists them; they are dropped rather than the expense refused). Restoring a deleted expense is refused (`not_in_flat`) if it would put money on someone who has left since.

### Friends: expenses outside a flat or group
Splitwise's non-group expenses ("with you and: …"), in `supabase/migrations/20261001000000_friends.sql`, rehearsed by `supabase/tests/rehearse_friends.py` (70 scenarios).
- **Stored as hidden circles.** Each such expense lives in a `flats` row of kind `direct` whose members are exactly the people on it plus whoever added it, so everything above (splits, payers, currencies, stored shares, delete/restore, feed, pushes, recurring, claiming) applies unchanged and only the people in an expense can see it. A friend's balance is the pairwise figures summed over every flat, group and circle the two share, per currency — worked out by the apps; there is no server function for it.
- **Apps write through `save_friend_expense(id, people, expense)`**: it finds or makes the circle for you + `people` (`[{user_id}]` for anyone you already share a flat/group/circle with, `[{email, name}]` for anyone else) and inserts or updates the expense there — moving it when an edit changes who is in it. Everyone with money on it must be in the circle, and everyone in the circle but you on the expense (`friends: someone you picked isn't on the expense`). Group and flat expenses are refused (`not_direct`). `friend_circle(people)` returns a circle on its own (settling up with a friend).
- **Circles stay closed**: no join code, no `invite_member`, no leaving (`leave_flat` and the web's own-row delete are refused), no `remove_member`. Someone already on Heimat is added at once and gets the usual push; someone who isn't gets a placeholder and **one email per circle**, sent with the first expense they are in (`invite_queued_at`) — what it was and their part of it (`supabase/functions/invite`, kind `direct`). Apps from before friends (Build 8/10) show a circle as a small group named after its people; its figures are right there too.
- **Looking someone up**: `find_person(email)` says whether the address is on Heimat and the name they go by (the owner chose to show it, as Splitwise does); 60 an hour per account. "On Heimat" (`heimat_account`) = a confirmed, undeleted address whose account uses Heimat (app_users or a claimed membership) — a MoneyTrack-only account is invited like anyone else.
- **One placeholder per address** (`placeholder_for`), wherever it was invited — groups included — so a person is one friend before they sign up. New circles: at most 30 new invitees and 100 circles a day per account.
- **Live since 2026-10-01** (migration `friends`): rehearsed 70/70 first; after applying, every balance's fingerprint (`ecfa5471…`) and every stored share unchanged, all 17 function bodies identical to the file, a rolled-back check on the live functions passed; `invite` function v4 deployed (verify_jwt off, own token check). No app has screens for it yet.
- **Taking over needs a confirmed address**: signing up claims when the address is confirmed (the `auth.users` trigger also fires on `email_confirmed_at`), and `claim_invites()` ignores unconfirmed addresses. `claim_invite(token)` with the invited, confirmed address also takes every other place that placeholder waits; anyone already in that flat or group can't use someone else's link (before, any member could read a pending invite's token and fold that person's money into their own account).

### Payments
Every payment has a currency (filled with the flat's main currency when an app doesn't say — Build 8; the payments from before were backfilled that way), is between two different people with a row in the flat (someone who has left counts — settling with them is the point), and is capped like a bill.

### Input parsing
`parseMinor` reads both conventions: `1.234,56`, `1,234.56`, `12,5`, `1 200`, `1'200.50`. A lone separator followed by exactly three digits is a thousands separator when the currency has < 3 decimals (`1.200` = 1200 €). More decimals than the currency has → refused, never rounded.

### Server-side rules

**Money guards** (`20261002030000_money_guards.sql`):
- Every takeover of a place (`claim_member`) checks its own work: a snapshot of every balance in the place, in every currency, before and after. Everyone else must be exactly where they were and the account must hold what it held plus what the place held — a cent out anywhere and the claim is refused with `money_guard` and nothing changes. On a merge (the account already on the same expense) the two shares are added, never re-split.
- `ledger_audit()` lists every inconsistency: a bill whose shares or payers don't add up to it, money booked to someone the place never had, a place whose balances don't come to zero in some currency. `run_ledger_audit()` runs it at 02:17 each night (cron `heimat-ledger-audit`), keeps what it finds in `ledger_audit_log`, and notifies `app_config.admin_user` when set. On 2026-10-01 it found nothing in the live books.
- `supabase/tests/rehearse_money_guards.py` proves both: takeovers across every split type, several payers, payments and two currencies, a merge, the old re-splitting rule put back (the guard must refuse it) and a deliberately broken bill (the audit must find it).
