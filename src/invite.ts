/* Where an invite email lands.

   Its own page rather than a screen inside the app, for the same reasons
   reset.ts is: it is opened by whatever browser the mail app hands it to, on a
   device that has usually never run Heimat, by someone who does not yet have
   an account and may not know what Heimat is. Booting the whole app — which
   signs in anonymously the moment it finds no session — to show one question
   would be slow, and would leave a stray guest account behind for anyone who
   says no.

   The token in ?t= is the whole credential. `invite_preview` reads the name of
   the flat or group, who asked, and the address it was sent to without any
   session, so the page can say who is inviting whom before asking for
   anything. Declining needs no account either.

   Accepting means signing up. Two things then claim the invite, and only one
   of them has to work: a trigger on auth.users hands over everything waiting
   for that email address the moment the account exists, and the page also
   calls claim_invite() with the token if it ends up holding a session — which
   covers signing up with a different address than the invite was sent to.

   Deliberately plain DOM: no React, no app state, no service worker. */
import { sb, friendlyAuthError } from './lib/supabase'
import { DK, LT } from './lib/theme'

const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches
const T = dark ? DK : LT
const root = document.getElementById('invite') as HTMLDivElement

const token = (new URLSearchParams(location.search).get('t') || '').trim()
/* the app lives in this page's own directory */
const appUrl = location.pathname.replace(/[^/]*$/, '')

document.documentElement.style.background = T.bg
document.body.style.cssText = `margin:0;background:${T.bg};color:${T.txt};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const pStyle = `font-size:14.5px;color:${T.txt2};line-height:1.55;margin:0 0 20px`
const inputStyle = `display:block;width:100%;box-sizing:border-box;background:${T.inp};color:${T.txt};border:1.5px solid ${T.border};border-radius:14px;padding:15px 16px;font-size:16px;outline:none;-webkit-appearance:none;margin-bottom:12px`
const btnStyle = (on: boolean) => `width:100%;box-sizing:border-box;background:${on ? T.acc : T.border};color:${on ? T.onAcc : T.txt3};border:none;border-radius:16px;padding:16px;font-weight:700;font-size:16px;cursor:${on ? 'pointer' : 'default'}`
const ghostStyle = `width:100%;box-sizing:border-box;background:transparent;color:${T.txt2};border:1.5px solid ${T.border};border-radius:16px;padding:15px;font-weight:600;font-size:15px;cursor:pointer;margin-top:10px`
const noteStyle = (color: string) => `font-size:13px;color:${color};line-height:1.5;margin:0 0 14px`
const linkStyle = `display:block;text-align:center;margin-top:16px;color:${T.txt2};font-size:13px;font-weight:600;text-decoration:none`

function shell(title: string, body: string) {
  root.innerHTML = `
    <div style="max-width:420px;margin:0 auto;padding:48px 20px 40px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px">
        <div style="width:34px;height:34px;border-radius:11px;background:${T.acc};display:flex;align-items:center;justify-content:center;color:${T.onAcc};font-weight:800;font-size:17px">H</div>
        <div style="font-size:17px;font-weight:700;letter-spacing:-0.2px">Heimat</div>
      </div>
      <h1 style="font-size:23px;font-weight:700;letter-spacing:-0.4px;margin:0 0 10px">${title}</h1>
      ${body}
    </div>`
}

type Preview = {
  flat_name: string | null
  flat_kind: string | null
  inviter: string | null
  invited_email: string | null
  invited_name: string | null
  open: boolean
}

/* ── 1. the question ── */
function ask(p: Preview) {
  const noun = p.flat_kind === 'flat' ? 'flat' : 'group'
  shell(
    `${esc(p.inviter || 'Someone')} wants to split with you`,
    `<p style="${pStyle}">They've added you to the ${noun} <strong style="color:${T.txt}">${esc(p.flat_name || 'a group')}</strong> on Heimat, where a few people keep track of what they've paid for and who owes what.</p>
     <p style="${pStyle}">Your share of anything they've already added is counted from now. Join to see it.</p>
     <div id="err" style="${noteStyle(T.red)};display:none"></div>
     <button id="yes" style="${btnStyle(true)}">Accept and join</button>
     <button id="no" style="${ghostStyle}">No thanks</button>
     <a href="heimat://invite/${encodeURIComponent(token)}" style="${linkStyle}">Already have the Heimat app? Open it there</a>
     <p style="font-size:12px;color:${T.txt3};line-height:1.5;margin:18px 0 0;text-align:center">Saying no removes you from the ${noun} and from anything you were split into. Nobody is told.</p>`,
  )
  const err = document.getElementById('err') as HTMLDivElement
  document.getElementById('yes')!.onclick = () => signUp(p)
  document.getElementById('no')!.onclick = async () => {
    const btn = document.getElementById('no') as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'One moment…'
    const { error } = await sb!.rpc('decline_invite', { p_token: token })
    if (error) {
      btn.disabled = false
      btn.textContent = 'No thanks'
      err.textContent = error.message
      err.style.display = 'block'
      return
    }
    shell(
      'That’s done',
      `<p style="${pStyle}">You've been taken out of ${esc(p.flat_name || 'the group')}, along with anything you were split into. You can close this page.</p>`,
    )
  }
}

/* ── 2. the account ── */
function signUp(p: Preview) {
  const noun = p.flat_kind === 'flat' ? 'flat' : 'group'
  shell(
    'Set up your account',
    `<p style="${pStyle}">One account, and ${esc(p.flat_name || 'the ' + noun)} is yours on any device you sign in on.</p>
     <input id="nm" type="text" autocomplete="name" placeholder="Your name" value="${esc(p.invited_name || '')}" style="${inputStyle}"/>
     <input id="em" type="email" autocomplete="email" inputmode="email" placeholder="Email" value="${esc(p.invited_email || '')}" style="${inputStyle}"/>
     <input id="pw" type="password" autocomplete="new-password" placeholder="Password, at least 8 characters" style="${inputStyle}"/>
     <div id="err" style="${noteStyle(T.red)};display:none"></div>
     <button id="go" style="${btnStyle(true)}">Create account</button>
     <a href="${appUrl}" style="${linkStyle}">I already have a Heimat account</a>
     <p style="font-size:12px;color:${T.txt3};line-height:1.5;margin:18px 0 0;text-align:center">Use the address this invite was sent to and ${esc(p.flat_name || 'the ' + noun)} will be waiting the moment you sign up.</p>`,
  )

  const nm = document.getElementById('nm') as HTMLInputElement
  const em = document.getElementById('em') as HTMLInputElement
  const pw = document.getElementById('pw') as HTMLInputElement
  const err = document.getElementById('err') as HTMLDivElement
  const go = document.getElementById('go') as HTMLButtonElement
  const fail = (m: string) => {
    err.textContent = m
    err.style.display = 'block'
    go.disabled = false
    go.textContent = 'Create account'
    go.style.cssText = btnStyle(true)
  }

  const submit = async () => {
    err.style.display = 'none'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim())) return fail('That email address doesn’t look right.')
    if (pw.value.length < 8) return fail('Use at least 8 characters.')
    go.disabled = true
    go.textContent = 'Creating…'
    go.style.cssText = btnStyle(false)

    const { data, error } = await sb!.auth.signUp({
      email: em.value.trim(),
      password: pw.value,
      options: { data: { display_name: nm.value.trim() }, emailRedirectTo: location.origin + appUrl },
    })
    if (error) return fail(friendlyAuthError(error, 'Couldn’t create the account. Please try again in a minute.'))

    /* The trigger has already handed over anything addressed to that email. If
       they signed up with a different one, the token still names this invite —
       and that needs a session, which only exists when confirmation is off. */
    if (data.session) await sb!.rpc('claim_invite', { p_token: token })

    if (data.session) installed(p)
    else confirmFirst(em.value.trim(), p)
  }

  go.onclick = submit
  pw.onkeydown = (e) => { if (e.key === 'Enter') submit() }
}

function confirmFirst(email: string, p: Preview) {
  shell(
    'Check your inbox',
    `<p style="${pStyle}">We've sent a link to <strong style="color:${T.txt}">${esc(email)}</strong>. Open it to confirm your account, and ${esc(p.flat_name || 'the group')} will be there when you sign in.</p>
     <a href="${appUrl}" style="${btnStyle(true)};display:block;text-align:center;text-decoration:none;box-sizing:border-box">Open Heimat</a>`,
  )
  homeScreen()
}

/* ── 3. keeping it ── */
function installed(p: Preview) {
  shell(
    `You’re in ${esc(p.flat_name || 'the group')}`,
    `<p style="${pStyle}">Everything they've split with you is there now.</p>
     <a href="${appUrl}" style="${btnStyle(true)};display:block;text-align:center;text-decoration:none;box-sizing:border-box">Open Heimat</a>`,
  )
  homeScreen()
}

/* Heimat in a browser tab is easy to lose, and on iOS notifications only work
   once it has been added to the home screen — so the instructions are worth
   showing, and worth being the ones for the device actually in hand rather
   than both sets at once. */
function homeScreen() {
  const ua = navigator.userAgent
  const android = /Android/.test(ua)
  // an iPad reports itself as a Mac with a touchscreen, which is the only way
  // to catch it — but an explicit Android in the UA settles it first, or that
  // test claims anything reporting both
  const ios =
    !android &&
    (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1))
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  if (standalone) return

  const steps = ios
    ? ['Tap the <strong>Share</strong> button at the bottom of Safari', 'Scroll down and tap <strong>Add to Home Screen</strong>', 'Tap <strong>Add</strong>']
    : android
      ? ['Tap the <strong>⋮</strong> menu, top right in Chrome', 'Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>)', 'Tap <strong>Install</strong>']
      : ['Open this page on your phone', 'Use your browser’s menu to add it to the home screen']

  const title = ios ? 'Keep Heimat on your home screen' : android ? 'Install Heimat' : 'Get it on your phone'
  const why = ios
    ? 'It opens like a normal app, and on iPhone it can only send you notifications once it’s there.'
    : 'It opens like a normal app and works offline.'

  root.insertAdjacentHTML(
    'beforeend',
    `<div style="max-width:420px;margin:0 auto;padding:0 20px 48px;box-sizing:border-box">
       <div style="border:1.5px solid ${T.border};background:${T.card};border-radius:20px;padding:20px">
         <div style="font-size:15.5px;font-weight:700;margin-bottom:6px">${title}</div>
         <p style="font-size:13px;color:${T.txt2};line-height:1.5;margin:0 0 14px">${why}</p>
         <ol style="margin:0;padding-left:20px;font-size:13.5px;color:${T.txt2};line-height:1.9">
           ${steps.map((s) => `<li>${s}</li>`).join('')}
         </ol>
       </div>
     </div>`,
  )
}

/* ── boot ── */
async function main() {
  if (!sb) {
    shell('Heimat isn’t configured', `<p style="${pStyle}">This copy of Heimat has no database connection. Ask whoever sent the invite to check it.</p>`)
    return
  }
  if (!/^[a-f0-9]{32}$/.test(token)) {
    shell('That link is incomplete', `<p style="${pStyle}">The invite code is missing from the address. Ask whoever invited you to send it again.</p>
      <a href="${appUrl}" style="${linkStyle}">Go to Heimat</a>`)
    return
  }

  shell('One moment…', `<p style="${pStyle}">Looking up your invite.</p>`)

  const { data, error } = await sb.rpc('invite_preview', { p_token: token })
  const p = (Array.isArray(data) ? data[0] : data) as Preview | undefined

  if (error || !p || !p.flat_name) {
    shell('That invite has expired', `<p style="${pStyle}">It may have been used already, or taken back. Ask whoever invited you to send a new one.</p>
      <a href="${appUrl}" style="${linkStyle}">Go to Heimat</a>`)
    return
  }
  if (!p.open) {
    shell('You’ve already joined', `<p style="${pStyle}">This invite to ${esc(p.flat_name)} has been used. Sign in and it'll be there.</p>
      <a href="${appUrl}" style="${btnStyle(true)};display:block;text-align:center;text-decoration:none;box-sizing:border-box">Open Heimat</a>`)
    return
  }
  ask(p)
}

main()
