# Heimat

**An everyday money-and-life companion for international students living abroad** — built first for non-EU ("third-country") students in Germany, but usable from any home country and in any host currency.

Most apps for internationals are *onboarding tools*: you use them intensely for two weeks around your visa, then delete them. Heimat is built around the things a student touches **every week** — shared-flat money, how long their funds will last, and staying under the legal work-hour limit.

## What it does

- **🏠 Flat** — split rent, utilities, groceries and the TV licence with your flatmates. Log a bill once and Heimat tracks *who owes whom*, settle-up included. (The everyday hook, like Splitwise — but free and multi-currency.)
- **💶 Money** — a *funds runway* meter: enter your blocked account (Sperrkonto) or yearly budget and see how many months it will last at your real spending. The number every student stares at, that no other app shows.
- **⏱ Work** — log shifts and stay under the German student work limit (~120 full days/year, ~20h/week as a Werkstudent). A green/amber/red "are you still legal" verdict. *No other app does this.*
- **🌍 Multi-currency** — every amount shown in your local currency **and** your home currency (₹, ¥, ₺, ₦, R$ …), with a live reference exchange rate.
- **👋 First-run onboarding** that sets up your name, home country/currency and host currency in under a minute.

## Privacy

No sign-up wall and no bank login — the app opens straight in, signed in
anonymously. Your profile, runway figures and work shifts never leave the device
(`localStorage`, keys namespaced `mt-h-*`). Only what a flat has to share —
expenses, settlements, the shopping list and display names — is synced, and only
to the people in that flat. Heimat never holds or moves your money. Full text:
[privacy policy](public/legal/privacy.html) · [terms](public/legal/terms.html).

## Tech

React 18 + TypeScript, built with Vite. Supabase (Postgres + Auth + realtime +
edge functions) for the shared-flat half; everything personal stays local. Ships
three ways from one codebase:

- **Web / PWA** — deployed to GitHub Pages by `.github/workflows/deploy.yml`.
- **iOS** — `ios/`, a Capacitor shell around the same bundle.
- **Android** — `android/`, likewise.

Notifications go out over web push, APNs and FCM from a single edge function
(`supabase/functions/push`), picked per device.

The Supabase project is shared with the author's MoneyTrack app — one database,
one set of accounts, two products. What that costs, how the password-reset flow
keeps the two apart, and the one dashboard setting it needs are in
[docs/password-reset.md](docs/password-reset.md).

## Run locally

```
npm install
npm run dev
```

Copy `.env.example` to `.env` first if you want the sync half to work.

For the apps: `npm run sync` builds and copies the bundle into both native
projects, then `npm run ios` / `npm run android` opens them. The full
store-submission path is in [RELEASE.md](RELEASE.md), and the listing copy in
[store/listing.md](store/listing.md).

## Status

`V0.5` — shared flats with realtime sync, accounts, shopping list, analytics and
push. Roadmap: German official-mail decoder, and a rolling visa/deadline
reminder ledger.

---

A standalone product, separate from the author's MoneyTrack personal-finance app — its own repo, its own data.
