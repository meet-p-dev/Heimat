# Friends and groups — the screens

Agreed with the owner on 2026-10-01. The database half is in `docs/money-engine.md` ("Friends").
Built for iOS and the web together, with the web brought to parity (groups and split screens included).

## Structure

- **The Flat tab becomes Groups.** A flat is just a group: one "New group" button and "Join with code"; "New flat" goes. Existing flats keep their code, members and history (`kind` stays as it is in the database).
- **Groups is a column of cards**, one per group, then the permanent **Non-group expenses** card (always there, also for someone with no group yet). A card shows only what is needed and reads as tappable (chevron, whole card pressable): the name, a small Invite button, a compact people line (avatars + count) and your balance there. Code, expenses, list and history live inside.
- **A group's page** is what the Flat tab shows today for the open flat.
- **Non-group expenses' page**: a search at the top ("Add an expense with… name or email"), your total with friends, then who owes whom — one row per person, money from non-group expenses only. Settled friends fold into one line.
- **A person's page** (tap a person anywhere): one total with them across everything you share, where it comes from (Non-group expenses, each group), your shared expenses, **Settle up** and **Remind**.
- **Home** is unchanged.

## Adding an expense

"With you and" replaces the Flat picker: pick a group (it books there, as before), or pick people (it becomes a non-group expense, `save_friend_expense`), or type an email. Typing an email says whether they are on Heimat and their name (`find_person`); someone who isn't gets an email with the expense. "Invite from contacts" opens the share sheet with their personal link.

## Settling up with a person

One payment, spread across every place the two of you owe each other in that currency (`Ledger.spread`, the same in TypeScript and Swift): the largest debt first, each place paid at most what it owes, and anything beyond the total goes to your non-group expenses with them. All the payments are written in one request, so either all land or none.

## Where it is (2026-10-01)

Built on both, not yet committed or shipped:
- **iOS**: `GroupsView.swift` (Groups cards, Non-group expenses, a person's page, settling up with a person, the people search and contact picker), `AppModel+Friends.swift`, `FlatView.swift` (now `GroupPage`), the "With you and" picker in `FlatForms.swift`.
- **Web**: `src/components/Friends.tsx`, `src/components/SplitEditor.tsx` (the iOS split screens, ported), `src/lib/places.ts`, `src/lib/friends.ts`; `App.tsx` loads every group and circle and listens to all of them; the expense form sends `split_type`, `split` and `payers` on every save.
- **Database**: someone from contacts without an email (a name and a link) needs `supabase/migrations/20261001010000_friends_by_link.sql` — rehearsed 75/75 with the first friends migration, not applied yet.

To look at the iOS screens without touching production: build Debug and launch with `-HeimatFixture` (`xcrun simctl launch booted app.heimat.mobile -HeimatFixture`) — made-up data, no network, nothing saved.
