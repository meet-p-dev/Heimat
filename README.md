# Heimat

A money-and-life companion for international students living abroad (built first for non-EU students in Germany).

- **Flat** — split shared costs with flatmates, track who owes whom
- **Money** — see how long your funds (e.g. a German blocked account) will last
- **Work** — log shifts and stay under the legal student work-hour limit
- Multi-currency (home + local), first-run onboarding, dark mode, fully offline

Single-file web app: React 18 + Babel-standalone via CDN, all data in `localStorage` (`mt-h-*` keys). No backend, no sign-up.

## Run
Open `index.html` through any static server (it can't load over `file://` reliably in all browsers):
`python3 -m http.server 8124` then visit http://127.0.0.1:8124/

Separate from MoneyTrack (the personal finance app) and the MoneyTracker iOS app — its own repo, its own data.
