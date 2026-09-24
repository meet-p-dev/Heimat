# Heimat for iOS — where things stand

Last updated: 2026-09-24

## Two apps share this repo

| | `src/` + `ios/App/` | `ios-native/` |
|---|---|---|
| Built with | React + Vite, wrapped by Capacitor | SwiftUI, from scratch |
| Bundle ID | `app.heimat.mobile` | `app.heimat.mobile` — **the same one** |
| Status | the older build | **the one being shipped** |

They share a bundle identifier, so installing one replaces the other on a
device. The SwiftUI app is the one going to TestFlight; the React app is still
the web build at the public URL.

Both talk to the same Supabase project (`vqvycbzrkeeuuhgrkpbf`), so flats,
expenses, settlements and the shopping list are shared between them. The
personal half — profile, shifts, settings — never leaves the phone.

## Building it

```sh
./scripts/native-ios.sh      # writes Generated/Secrets.swift from .env, runs xcodegen
```

`Heimat.xcodeproj` and `Heimat/Generated/` are generated and git-ignored. Edit
`ios-native/project.yml`, never the `.xcodeproj` — regenerating discards it.
That includes capabilities: entitlements are declared in `project.yml`.

Team `Q3BTHLU74C`, paid Apple Developer Program (went live 2026-09-22). Push,
App Groups and iCloud all need that membership; before it, device builds could
not sign.

## What is built

**Design.** All tabs are free-form card columns, not grouped `List`s, because
the grids have no `List` equivalent. Shared primitives in `Components.swift`
mirror the web's `ui.tsx`: `HeimatCard` (real `.glassEffect`), `QuickAction`,
`Chip`, `HeimatRow`, `SectionLabel`, `PressStyle`, `Tint`. `HeimatHeader`
replaces the system navigation bar so titles sit on the same 16pt gutter as
content. `Surface.swift` draws the ambient background.

**Tabs** (`HeimatApp.swift`) are an offset `HStack` driven by our own
`DragGesture`, not a `TabView` and not a horizontal `ScrollView`, so a drag
carries the page. `GlassTabBar` reads the same offset, so its indicator travels
with the finger and stretches between tabs mid-crossing.

**Groups and invites.** A `flats` row is either the flat you live in
(`kind = 'flat'`) or a group you split with (`kind = 'group'`); everything
downstream hangs off `flat_id` and never asks which. Someone who isn't on
Heimat can still be added, by email: they get a member row with a placeholder
id, and that id is what expenses and settlements point at, so their share
counts from the moment they are added. Membership is a *claimed* membership,
so the placeholder grants no access to anything. Signing up with that address
claims it — a trigger on `auth.users` rewrites every reference to the real
account, on any client, without the client asking. `heimat://invite/<token>`
claims one specific invite and jumps to the group.

The invite email goes out from the `invite` edge function via Resend, and
needs `resend_key` in `app_config` before anything is sent; without it the
invite is still saved and the function says so. `invite_from` must be on a
domain verified with Resend. The email links to `public/invite.html`.

The invite email lands on `invite.html` / `src/invite.ts` — a Vite entry, not
a public/ asset, built the way `reset.ts` is: plain DOM, no React, no app
boot, opened cold by a stranger who has no account. `invite_preview()` reads
who invited them and to what with no session at all, so the page can ask
before it asks for anything. Declining needs no account either, and takes them
back out of every split they were in. Accepting means signing up, after which
it shows how to add Heimat to the home screen — the steps for the device in
hand, since iOS and Android differ and iOS only allows notifications once it
is installed.

The web app filters flats to `kind = 'flat'`, so groups are the native app's
alone for now.

Notifications for an expense reach the people it is split between plus
whoever paid — not the whole flat.

**Push** (`Push.swift`). Stores the APNs token as `apns:<token>` in
`push_subscriptions`. The server half already existed and is shared with the
web build — `supabase/functions/push` plus database triggers. No server work is
needed for new clients.

**App Intents** (`Intents.swift`). `AddExpenseIntent`, `LogShiftIntent`,
`OpenAddExpenseIntent`. These are the single implementation behind Siri, the
Shortcuts app, the widget's button and any Control Center control.

**Widgets** (`HeimatWidgets/`). Configurable metric, four sizes, Lock Screen
ring. Reads a snapshot the app writes into the `group.app.heimat.mobile` App
Group — widgets must never touch the network.

**iCloud** (`CloudBackup.swift`). Backs the on-device half up through
`NSUbiquitousKeyValueStore`. Off by default. Backup and restore, not live sync.

**Home** (`HomeView.swift`) answers where you stand across every flat and
group at once, not in whichever one is open. Adding an expense from there asks
which flat it belongs to.

**Removing, leaving and nudging.** Removal is refused while someone is up or
down. Anyone with history is marked as having left rather than deleted (see
the bugs below). A nudge reaches one person, once a day, and only when they
owe.

**History** (`HistoryView` in `FlatView.swift`). Every change writes a row to
`activity` from database triggers, so an expense edited on the web, added by
Siri or deleted from a widget all land the same way and no client can skip it.
Read-only to everyone. Backfilled from what was already stored, additions
only — edits and deletions from before it existed left nothing to recover.

**Analytics** (in `FlatView.swift`). Tapping a month bar scopes every figure to
it; a category opens to the expenses behind it.

## Deliberately not here

- **The Money tab and the whole funds-runway feature**, removed 2026-09-23 at
  the user's request. Old installs may still have an orphaned `runway` key in
  `UserDefaults`; nothing reads it.
- **The currency converter**, which lived only in the Money tab. Currencies and
  the exchange rate are still in Settings.

## Shipping

TestFlight, via Xcode Organizer → Distribute App → TestFlight & App Store.

**Build 7 is live with external testers** — everything below is in their
hands, not just the simulator.

**The build number must increase every upload** — bump
`CURRENT_PROJECT_VERSION` in `project.yml`. Xcode's distribute flow
auto-increments on the way out, so the number on App Store Connect can run
ahead of the repo's. Check TestFlight before archiving.

Archiving from the command line works and lands in the Organizer:

```sh
xcodebuild -project ios-native/Heimat.xcodeproj -scheme Heimat \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$HOME/Library/Developer/Xcode/Archives/$(date +%F)/Heimat.xcarchive" \
  -allowProvisioningUpdates archive
```

Uploading a build does not give it to anyone. Each build is attached to
groups, and a fresh upload goes to the internal group only. An external group
with no build reports "No Compatible Build", its testers read "No Builds
Available", and its public link says the beta isn't accepting testers — which
is what it did for a week while the upload was blamed.

So for external testers: add the build to the external group, which submits it
for **Beta App Review** (needs the Test Information filled in, including a
phone number). Internal testers skip review entirely.

`aps-environment` is `development` for Debug and `production` for Release.
An archive will read `development`; Xcode substitutes `production` when it
re-signs during export. That is expected.

## Verified, and not

Driven in the simulator and confirmed working: the swipe pager and its
indicator (with deliberately thumb-like diagonal drags — see the bugs below), push permission and delivery of a notification, App Intents run from
Shortcuts, the widget on the home screen with live data and a working button,
Analytics month selection and drill-down.

Groups were driven end to end in the simulator against the live database —
create, invite by email, pending member shown, expense split with them, correct
balances — and the sign-up claim was tested in SQL with a throwaway auth user.
Test data was removed afterwards.

Invite email goes out through Gmail SMTP and is confirmed arriving. Resend is
still configured behind it and takes over the moment the SMTP keys are removed.

**Not yet verified on a real device:** iCloud backup then restore, and a push
arriving from a Supabase trigger. Neither could be tested in the simulator —
simulator builds carry no entitlements, so `ubiquityIdentityToken` is always
nil, and an APNs token from a simulator is not one the server can reach.

Also unverified: the Siri phrases. App Shortcut tiles fail in the simulator with
`Couldn't find AppShortcutsProvider`, which is a known simulator limitation —
the compiled metadata is correct.

## Bugs worth remembering

- A decorative background must be `.allowsHitTesting(false)`. The ambient wash
  silently swallowed every touch inside every `Form` until it was.
- `AppModel.shifts` rewrites the whole array on any change, so an intent writing
  to `UserDefaults` behind a running app was erased on the next edit. Intents go
  through the live model when there is one; `reloadLocal()` re-reads on
  foreground when there is not.
- A foreground push is dropped unless `UNUserNotificationCenterDelegate`
  asks for it. It looks exactly like a push that never arrived.
- A vertical `ScrollView` nested inside a horizontal paging `ScrollView` wins
  every drag that starts even slightly off the horizontal, so tab swiping
  worked under a mouse and never under a thumb. Test gestures with a few
  points of drift, not straight lines — a clean drag proves nothing.
- While our drag owns the gesture the pages are `.disabled`, which is what
  drops the press underneath. `.allowsHitTesting(false)` does not: a touch
  already being delivered carries on to the row and opens it.
- Deleting a member row strands their id in `expenses.split_among` and in
  `paid_by`. The old balance maths counted only ids it could name while still
  dividing by the whole split, so the flat quietly stopped adding up — it cost
  a real €110 here. Anyone with history is now marked `left_at` instead, by a
  BEFORE DELETE trigger, and the ledger no longer looks at the member list at
  all: every id in an expense or settlement keeps its money on the books.
- A per-flat net cannot be added across flats. Two people square in one flat
  and square in another say nothing about what they owe each other, so Home
  uses `Ledger.pairwise`. The Flat tab uses it too, because the settlement
  simplification moves debts onto whoever makes the fewest payments and was
  being shown as though it were the debt itself.
- Money is whole cents (`Ledger.swift`, `src/lib/ledger.ts`, and
  `flat_balance()` in SQL — three implementations of one set of rules). An
  expense is split into cents that add up to its total, the odd cent going to
  whoever sorts first by FNV-1a of expense id + user id, so every figure is a
  sum of the same shares and a flat sums to exactly zero. `npm test` holds the
  Swift to the web's answers through `tests/ledger-vectors.json`; change the
  rules in one place and the other two fail until they match.
- Never sort a `Dictionary` and show the result. Its order is randomised per
  launch, and `sorted(by:)` keeps it for ties — the settle-up plan named a
  different person on different launches with the same data. Every tie needs
  an id to break it.
- Swift's number formatting rounds half to even; the web's rounds half away
  from zero. 1.234,50 € rent between four printed 308,62 € on the phone and
  308,63 € on the web. `Fmt.money` sets the rule explicitly.
- "1.200" typed into a German-formatted money app is twelve hundred euros.
  Parsing it by swapping commas for dots made it €1,20; `Money.parse` knows
  a euro amount cannot have three decimals.
- The expense id seeds who takes the odd cent, so a new expense's id is made
  on the phone — lowercased, because Postgres hands uuids back lowercase — and
  the split previewed is the split saved.
- Postgres grants EXECUTE to PUBLIC and PostgREST turns that into an endpoint.
  Every new SECURITY DEFINER function needs its grants set deliberately, or a
  helper whose permission check lives in its caller is callable by anyone with
  the anon key. Run the security advisor after adding any.
- Group history by the local date, not by slicing the UTC timestamp — anything
  after local midnight files itself under yesterday.
- A verification query that joins on `user_id` without aggregating first
  double-counts anyone who is a member of two flats. The app was right and the
  check was wrong; it is worth being suspicious of the checker too.

## Next

- **Storing an invited person's email needs a line in the privacy policy**,
  before this goes anywhere near the App Store.
- Invites currently leave from a personal Gmail. A domain would fix the From
  address, the links, and let Resend take over again — two config values, no
  code. See `supabase/functions/invite/index.ts`.
- The one-line guard in `src/App.tsx` that hides groups from the web app is
  **still uncommitted**, sitting among other in-progress edits there. Until it
  ships, groups appear as flats on the web.
- Invites are email only. SMS would mean Twilio and a per-message cost.
- The web app can create and see flats but not groups.
- Headless quick-add from the widget, using `Button(intent:)`.
- Expense amounts are split evenly and nothing else. Uneven shares, shares by
  percentage and itemised bills are all Splitwise features this does not have.
