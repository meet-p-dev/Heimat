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

No account, no sign-up, no bank login. **All data stays on your device** (`localStorage`). Heimat never holds or moves your money — it only helps you see it clearly.

## Tech

Single-file web app — React 18 + Babel-standalone via CDN, no build step, no backend. Works added to your iPhone/Android home screen. Data keys are namespaced `mt-h-*`.

## Run locally

```
python3 -m http.server 8124
```
then open http://127.0.0.1:8124/ (it needs a server, not a double-clicked `file://`, to load reliably).

## Status

`V0.1` — first working version. Roadmap: invite-flatmates-by-link (real multi-device sync), German official-mail decoder, and a rolling visa/deadline reminder ledger.

---

A standalone product, separate from the author's MoneyTrack personal-finance app — its own repo, its own data.
