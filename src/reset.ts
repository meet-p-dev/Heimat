/* The far end of Heimat's password-reset pipeline.

   A page of its own rather than a sheet inside the app, for three reasons. The
   link is opened by whatever browser the mail app hands it to, often on a device
   that has never run Heimat — so booting the whole app (which signs in
   anonymously when it finds no session) just to show one password field is both
   slow and a race worth not having. The recovery session it arrives with is a
   temporary credential, and the less of the app that touches it the better. And
   Heimat shares an origin and a Supabase project with MoneyTrack, so the page a
   reset link lands on has to say plainly which of the two it belongs to.

   Deliberately plain DOM: no React, no app state, no service worker dependency.
   The page has to work on the first load, cold, on a stranger's browser. */
import { sb } from './lib/supabase'
import { touchAppUser } from './lib/appUser'
import { DK, LT } from './lib/theme'

const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches
const T = dark ? DK : LT
const root = document.getElementById('reset') as HTMLDivElement

/* Where "back to Heimat" points. The page is served from inside the app's own
   directory, so its parent is the app. */
const appUrl = location.pathname.replace(/[^/]*$/, '')

document.documentElement.style.background = T.bg
document.body.style.cssText = `margin:0;background:${T.bg};color:${T.txt};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

function shell(title: string, body: string) {
  root.innerHTML = `
    <div style="max-width:420px;margin:0 auto;padding:48px 20px 40px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px">
        <div style="width:34px;height:34px;border-radius:11px;background:${T.acc};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:17px">H</div>
        <div style="font-size:17px;font-weight:700;letter-spacing:-0.2px">Heimat</div>
      </div>
      <h1 style="font-size:23px;font-weight:700;letter-spacing:-0.4px;margin:0 0 10px">${title}</h1>
      ${body}
    </div>`
}

const pStyle = `font-size:14px;color:${T.txt2};line-height:1.55;margin:0 0 20px`
const inputStyle = `display:block;width:100%;box-sizing:border-box;background:${T.inp};color:${T.txt};border:1.5px solid ${T.border};border-radius:14px;padding:15px 16px;font-size:16px;outline:none;-webkit-appearance:none;margin-bottom:12px`
const btnStyle = (on: boolean) => `width:100%;box-sizing:border-box;background:${on ? T.acc : T.border};color:#fff;border:none;border-radius:16px;padding:16px;font-weight:700;font-size:16px;cursor:${on ? 'pointer' : 'default'}`
const linkStyle = `display:block;text-align:center;margin-top:16px;color:${T.txt2};font-size:13px;font-weight:600;text-decoration:none`
const noteStyle = (color: string) => `font-size:13px;color:${color};line-height:1.5;margin:0 0 14px`

/* ── the password form, shown once a recovery session is in hand ── */
function askForNewPassword(email: string | null) {
  shell(
    'Choose a new password',
    `<p style="${pStyle}">${email ? `You are resetting the password for <strong style="color:${T.txt}">${esc(email)}</strong>.` : 'You followed a valid reset link.'} Pick a new one and you will be signed in straight away.</p>
     <input id="pw" type="password" autocomplete="new-password" placeholder="New password, at least 6 characters" style="${inputStyle}"/>
     <input id="pw2" type="password" autocomplete="new-password" placeholder="Repeat it" style="${inputStyle}"/>
     <div id="err" style="${noteStyle(T.red)};display:none"></div>
     <button id="go" style="${btnStyle(true)}">Save new password</button>
     <p style="font-size:12px;color:${T.txt3};line-height:1.5;margin:18px 0 0;text-align:center">This password is for your Heimat account. It does not change anything on your device — your work shifts and runway never leave it.</p>`,
  )

  const pw = document.getElementById('pw') as HTMLInputElement
  const pw2 = document.getElementById('pw2') as HTMLInputElement
  const err = document.getElementById('err') as HTMLDivElement
  const go = document.getElementById('go') as HTMLButtonElement
  const fail = (m: string) => { err.textContent = m; err.style.display = 'block' }

  const submit = async () => {
    err.style.display = 'none'
    if (pw.value.length < 6) return fail('Use at least 6 characters.')
    if (pw.value !== pw2.value) return fail('The two passwords do not match.')
    go.disabled = true
    go.textContent = 'Saving…'
    go.style.cssText = btnStyle(false)
    const { error } = await sb!.auth.updateUser({ password: pw.value })
    if (error) {
      go.disabled = false
      go.textContent = 'Save new password'
      go.style.cssText = btnStyle(true)
      return fail(error.message)
    }
    // the account has now proved it is a Heimat account, so record it as one
    await touchAppUser()
    done()
  }
  go.onclick = submit
  pw2.onkeydown = (e) => { if (e.key === 'Enter') submit() }
  pw.focus()
}

function done() {
  shell(
    'Password changed',
    `<p style="${pStyle}">You are signed in on this browser. Open Heimat and your flat, its expenses and its balances are where you left them.</p>
     <a href="${appUrl}" style="${btnStyle(true)};display:block;text-align:center;text-decoration:none;line-height:1.2">Open Heimat</a>
     <p style="font-size:12px;color:${T.txt3};line-height:1.5;margin:18px 0 0;text-align:center">Using the phone app? Go back to it and sign in with your new password.</p>`,
  )
}

/* ── dead link: expired, already used, or opened without a token at all ── */
function askForANewLink(reason: string) {
  shell(
    'This reset link has expired',
    `<p style="${pStyle}">${esc(reason)} Reset links are single-use and last an hour. Enter your email and Heimat will send a fresh one.</p>
     <input id="mail" type="email" inputmode="email" autocapitalize="none" autocomplete="email" placeholder="you@example.com" style="${inputStyle}"/>
     <div id="err" style="${noteStyle(T.red)};display:none"></div>
     <div id="ok" style="${noteStyle(T.green)};display:none"></div>
     <button id="go" style="${btnStyle(true)}">Send a new link</button>
     <a href="${appUrl}" style="${linkStyle}">Back to Heimat</a>`,
  )

  const mail = document.getElementById('mail') as HTMLInputElement
  const err = document.getElementById('err') as HTMLDivElement
  const ok = document.getElementById('ok') as HTMLDivElement
  const go = document.getElementById('go') as HTMLButtonElement

  const submit = async () => {
    err.style.display = 'none'
    ok.style.display = 'none'
    if (!/\S+@\S+\.\S+/.test(mail.value)) { err.textContent = 'Enter your email address.'; err.style.display = 'block'; return }
    go.disabled = true
    go.textContent = 'Sending…'
    const { error } = await sb!.auth.resetPasswordForEmail(mail.value.trim(), { redirectTo: location.origin + location.pathname })
    go.disabled = false
    go.textContent = 'Send a new link'
    if (error) { err.textContent = error.message; err.style.display = 'block'; return }
    // said the same way whether or not the address has an account, so the page
    // can't be used to find out who has one
    ok.textContent = `If ${mail.value.trim()} has a Heimat account, a new link is on its way. Open it on this device.`
    ok.style.display = 'block'
  }
  go.onclick = submit
  mail.onkeydown = (e) => { if (e.key === 'Enter') submit() }
  mail.focus()
}

/* ── entry ──
   Supabase bounces the emailed link through /auth/v1/verify and lands here with
   either a token fragment (the implicit flow both apps use), a ?code= to trade
   in (PKCE, should either app switch), or an error spelling out what went wrong.

   The arriving URL is read from the snapshot reset.html takes before the
   Supabase client loads, because the client wipes the fragment as it starts. */
async function start() {
  shell('Checking your link…', `<p style="${pStyle}">One moment.</p>`)

  if (!sb) return askForANewLink('Heimat could not reach the server.')

  const arrived = new URL((window as any).__heimatResetUrl || location.href)
  const hash = new URLSearchParams(arrived.hash.replace(/^#/, ''))
  const query = arrived.searchParams

  const errCode = hash.get('error_code') || query.get('error_code')
  const errDesc = hash.get('error_description') || query.get('error_description')
  if (errCode || errDesc) {
    return askForANewLink(
      /expired/.test(errCode || '') ? 'The link had already run out.' : (errDesc || '').replace(/\+/g, ' ') || 'The link could not be used.',
    )
  }

  /* Only a link gets you the password form. Without this the page would hand a
     "choose a new password" box to anyone who merely opened the URL while the
     app happened to have a session in this browser — including the anonymous
     session Heimat gives every visitor. */
  const code = query.get('code')
  const viaLink = !!code || hash.get('type') === 'recovery' || !!hash.get('access_token')
  if (!viaLink) {
    return askForANewLink('This page is the last step of a password reset, and it was opened without a link.')
  }

  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code)
    if (error) return askForANewLink(error.message)
  }

  // getSession() waits for the client to finish reading the URL, so by here the
  // recovery token in the fragment has either become a session or never will
  const { data } = await sb.auth.getSession()
  const user = data.session?.user
  if (!user) return askForANewLink('That link could not be used.')
  // an anonymous session is a device, not an account — it cannot be the subject
  // of a password reset, and finding one here means the link never took effect
  if (!user.email) return askForANewLink('That link could not be used.')

  // strip the token out of the address bar before anything can copy it
  history.replaceState(null, '', arrived.pathname)
  askForNewPassword(user.email)
}

start()
