/* Where a group's invite link lands: join.html?c=<code>.

   The link is shared in chats, so it opens in whatever browser the phone picks — with or
   without Splitlife installed. The page offers the app first (it opens straight into the
   join form, code filled in), then where to get it, then the browser, which does
   everything the app does. Nothing joins until the person taps Join themselves.

   Plain DOM, like invite.ts: no React, no session, no anonymous account left behind by
   someone who only looked. */
import { DK, LT } from './lib/theme'
import { device, openAppHref, downloadHref } from './lib/getApp'

const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches
const T = dark ? DK : LT
const root = document.getElementById('join') as HTMLDivElement
const q = new URLSearchParams(location.search)
const code = (q.get('c') || '').trim().toUpperCase()
/* back from Android's "open the app" when it isn't installed */
const noApp = q.get('app') === '0'
/* the app lives in this page's own directory */
const appUrl = location.pathname.replace(/[^/]*$/, '')

document.documentElement.style.background = T.bg
document.body.style.cssText = `margin:0;background:${T.bg};color:${T.txt};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const pStyle = `font-size:14.5px;color:${T.txt2};line-height:1.55;margin:0 0 20px`
const btn = `display:block;width:100%;box-sizing:border-box;background:${T.acc};color:${T.onAcc};border:none;border-radius:16px;padding:16px;font-weight:700;font-size:16px;text-align:center;text-decoration:none`
const ghost = `display:block;width:100%;box-sizing:border-box;background:transparent;color:${T.txt};border:1.5px solid ${T.border};border-radius:16px;padding:15px;font-weight:600;font-size:15px;text-align:center;text-decoration:none;margin-top:10px`
const small = `font-size:12.5px;color:${T.txt3};line-height:1.5;margin:14px 0 0;text-align:center`

function shell(title: string, body: string) {
  root.innerHTML = `
    <div style="max-width:420px;margin:0 auto;padding:48px 20px 40px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px">
        <img src="${appUrl}favicon.svg" alt="" width="34" height="34" style="border-radius:11px"/>
        <div style="font-size:17px;font-weight:700;letter-spacing:-0.2px">Splitlife</div>
      </div>
      <h1 style="font-size:23px;font-weight:700;letter-spacing:-0.4px;margin:0 0 10px">${title}</h1>
      ${body}
    </div>`
}

function main() {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    shell('That link is incomplete', `<p style="${pStyle}">The group code is missing from the address. Ask whoever sent it for the code, or a new link.</p>
      <a href="${appUrl}" style="${ghost}">Go to Splitlife</a>`)
    return
  }
  const d = device()
  const phone = d !== 'other'
  const here = `${location.origin}${location.pathname}?c=${encodeURIComponent(code)}&app=0`
  const browser = `${appUrl}?join=${encodeURIComponent(code)}`
  const get = downloadHref()
  const codeBox = `
    <div style="border:1.5px solid ${T.border};background:${T.card};border-radius:20px;padding:18px;text-align:center;margin-bottom:20px">
      <div style="font-size:12.5px;color:${T.txt3};font-weight:600;margin-bottom:6px">Group code</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;color:${T.acc};font-variant-numeric:tabular-nums">${esc(code)}</div>
    </div>`
  const intro = `<p style="${pStyle}">Someone wants to split bills with you on Splitlife — who paid for what, and who owes whom. Nothing happens until you tap Join.</p>`

  let actions: string
  if (phone && !noApp) {
    actions = `
      <a href="${openAppHref(`join/${encodeURIComponent(code)}`, here)}" style="${btn}">Open in the Splitlife app</a>
      <a href="${browser}" style="${ghost}">Join in the browser instead</a>
      ${get ? `<p style="${small}">Don't have the app? <a href="${get}" style="color:${T.acc};font-weight:600">Get Splitlife</a></p>`
            : `<p style="${small}">No app on this phone? The browser works just the same.</p>`}`
  } else if (phone) {
    // Android came back here: the app isn't installed
    actions = `
      ${get ? `<a href="${get}" style="${btn}">Get the Splitlife app</a>` : ''}
      <a href="${browser}" style="${get ? ghost : btn}">Join in the browser</a>
      <p style="${small}">${get ? 'Splitlife isn’t on this phone yet — get the app, then open this link again, or use it in the browser.' : 'Splitlife isn’t on this phone yet — use it in the browser, it does everything the app does.'}</p>`
  } else {
    actions = `
      <a href="${browser}" style="${btn}">Join in the browser</a>
      <p style="${small}">On your phone? Open this link there and it goes straight to the app.</p>`
  }
  shell('You’re invited to a group', intro + codeBox + actions)
}

main()
