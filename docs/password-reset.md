# Password reset, and the line between Heimat and MoneyTrack

Heimat and MoneyTrack are separate products in separate repos that happen to
share one Supabase project (`vqvycbzrkeeuuhgrkpbf`): one Postgres, one
`auth.users`, one set of auth email templates. That is deliberate — one database,
one bill, one place to look. It also means the two apps have to be explicit
about a few things a single-app project gets for free.

## What is shared and what is not

| | Shared | Separate |
|---|---|---|
| Postgres | ✔ one database | tables are prefixed: `flats`, `flat_*`, `expenses`, `settlements`, `push_subscriptions` are Heimat's; `mt_*` are MoneyTrack's |
| Accounts | ✔ one `auth.users` — one email and password unlocks both | membership and per-app profile live in `app_users` |
| Sessions | — | Heimat stores under `heimat-auth`, MoneyTrack under `mt-sb-auth`, so signing into one never signs you out of the other even on a shared origin |
| Reset page | — | each app has its own: Heimat's `reset.html`, MoneyTrack's `/reset/` |
| Auth emails | ✔ one template per email type | the link inside carries whichever app sent it |

The password itself is genuinely shared. There is one `auth.users` row per
person, so resetting from Heimat changes the password MoneyTrack asks for too.
Splitting that would take a second Supabase project purely for auth.

## `app_users`

```
app_users(user_id, app, display_name, prefs, created_at, last_seen_at)
  primary key (user_id, app)     app in ('heimat', 'moneytrack')
```

One row per (account, app). RLS restricts every row to `auth.uid() = user_id`,
so nothing here is visible across accounts. Each app writes its own row when a
sign-in, an account save, or a completed reset proves the account is one of
its own — see `src/lib/appUser.ts` here and `lib/appUser.js` in MoneyTrack.
Anonymous Heimat sessions are skipped: they are devices, not accounts.

Writes fail soft. Membership is bookkeeping and must never cost anyone a
sign-in.

## The reset pipeline

1. **Ask.** "Forgot your password?" on the sign-in sheet calls
   `resetPasswordForEmail(email, { redirectTo: resetUrl() })`.
   `resetUrl()` (`src/lib/native.ts`) resolves to `<app>/reset.html`, or to
   `VITE_RESET_URL` when that is set.
2. **Email.** Supabase sends its recovery template. The link goes through
   `/auth/v1/verify` and bounces to the `redirectTo` — which is why that URL has
   to be allow-listed (below), or Supabase silently falls back to the project's
   Site URL and the user lands in the wrong app.
3. **Land.** `reset.html` is a build entry of its own, not the app: no React, no
   app state, no service worker, and — importantly — none of Heimat's
   sign-in-anonymously-on-boot. It reads the recovery token out of the fragment,
   turns it into a session, and asks for the new password.
4. **Finish.** `updateUser({ password })`, then the account is recorded in
   `app_users`, then the page offers a link back into the app. The browser is
   left signed in.

Native iOS/Android finish in the browser too: the emailed link opens the web
reset page, and the user returns to the app and signs in with the new password.

### The gate that matters

The page only shows the password form when it was actually reached by a link —
`type=recovery` or an `access_token` in the fragment, or a `?code=` to exchange.
Without that check it would hand a "choose a new password" box to anyone who
merely opened the URL while a session sat in the browser, including the
anonymous one Heimat gives every visitor.

Three failure paths, all landing on "send me a fresh link":

- Supabase returned `error_code=otp_expired` → *the link had already run out*
- a token that no longer resolves to a session → *that link could not be used*
- no link at all → *opened without a link*

The "we sent it" message is worded identically whether or not the address has an
account, so the page can't be used to find out who has one.

## Supabase dashboard — required once

**Authentication → URL Configuration → Redirect URLs** must contain all four:

```
https://meet-p-dev.github.io/Heimat/reset.html
https://meet-p-dev.github.io/Heimat/**
https://meet-p-dev.github.io/refactored-octo-tribble/reset/
https://meet-p-dev.github.io/refactored-octo-tribble/**
```

Add `http://localhost:5173/reset.html` and
`http://localhost:3123/refactored-octo-tribble/reset/` for local testing.

Also worth turning on while you are there: **Authentication → Policies → Leaked
password protection**, which checks new passwords against HaveIBeenPwned. It is
off today, and a reset flow is exactly where it earns its keep.

## Moving to separate domains

Both reset URLs are overridable, so the split is a config change rather than a
code change:

- Heimat: `VITE_RESET_URL=https://heimat.example/reset.html`
- MoneyTrack: `NEXT_PUBLIC_MT_RESET_URL=https://moneytrack.example/reset/`

Add the new URLs to the redirect allow-list before switching. Separate origins
would also make the separate session storage keys redundant — keep them anyway,
they cost nothing.
