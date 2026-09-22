# Heimat for iOS — where things stand

Last updated: 2026-09-23

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

**Tabs** (`HeimatApp.swift`) are a paging `ScrollView`, not a `TabView`, so a
drag carries the page. `GlassTabBar` reads that scroll offset, so its indicator
travels with the finger and stretches between tabs mid-crossing.

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

**The build number must increase every upload** — bump
`CURRENT_PROJECT_VERSION` in `project.yml`. Build 1 is uploaded; build 2 is
archived and ready.

`aps-environment` is `development` for Debug and `production` for Release.
An archive will read `development`; Xcode substitutes `production` when it
re-signs during export. That is expected.

## Verified, and not

Driven in the simulator and confirmed working: the swipe pager and its
indicator, push permission and delivery of a notification, App Intents run from
Shortcuts, the widget on the home screen with live data and a working button,
Analytics month selection and drill-down.

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

## Next

- Expenses with people outside a flat: add `flats.kind`, make
  `flat_members.user_id` nullable with an invited email, and key
  `expenses.parts[]` on `flat_members.id` rather than `user_id`. That last part
  touches RLS, the balance maths and the notify triggers. Invite by share link
  rather than SMS. Storing a non-user's email needs a privacy-policy line.
- Headless quick-add from the widget, using `Button(intent:)`.
