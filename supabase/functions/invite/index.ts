// Emails someone who has been added to a flat or a group but isn't on Heimat
// yet, so they know a bill is waiting and where to claim it. Called by the
// member_invited trigger, never by the client — auth is the same shared token
// in app_config that the push function uses.
//
// Everything it needs is in app_config, so a key can be added or rotated
// without redeploying: `resend_key` turns sending on at all, `invite_from` is
// the From address (it must be on a domain verified with Resend), and
// `public_url` is where invite.html is served. With no key the function says
// so and returns 200 — the invite itself is already saved either way, and the
// person can still be let in by the code on the flat's Invite screen.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Payload = {
  token: string
  event: 'invited'
  email: string
  name?: string
  invite: string
  flat?: string
  kind?: 'flat' | 'group'
  inviter?: string
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const cfg = async (): Promise<Record<string, string>> => {
  const { data } = await admin.from('app_config').select('key,value')
  return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const body = (p: Payload, link: string) => {
  const who = esc(p.inviter || 'Someone')
  const place = esc(p.flat || (p.kind === 'flat' ? 'their flat' : 'their group'))
  const noun = p.kind === 'flat' ? 'flat' : 'group'
  return `<!DOCTYPE html><html><body style="margin:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:440px;margin:0 auto;padding:32px 20px">
  <div style="background:#fff;border-radius:22px;padding:28px 24px">
    <h1 style="font-size:21px;margin:0 0 12px;color:#0c1110;letter-spacing:-.3px">${who} split an expense with you</h1>
    <p style="font-size:15px;line-height:1.55;color:#5d6b65;margin:0 0 22px">
      You've been added to the ${noun} <strong style="color:#0c1110">${place}</strong> on Heimat, a small app for sharing flat and trip costs.
      Your share is already counted — open the link to see what it is.
    </p>
    <a href="${link}" style="display:block;text-align:center;background:#0b6b4f;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px;border-radius:14px">See the expense</a>
    <p style="font-size:13px;line-height:1.5;color:#8b968f;margin:18px 0 0">
      Sign up with this email address and it'll be waiting for you. If you weren't expecting this, ignore it — nothing is shared with you until you do.
    </p>
  </div>
</div></body></html>`
}

Deno.serve(async (req) => {
  try {
    const p = (await req.json()) as Payload
    const c = await cfg()

    if (!c.push_token || p.token !== c.push_token) {
      return new Response('unauthorized', { status: 401 })
    }
    if (!p.email || !p.invite) return new Response('nothing to send', { status: 200 })
    if (!c.resend_key) return new Response('no resend_key in app_config — invite saved, email skipped', { status: 200 })

    const base = (c.public_url || 'https://meet-p-dev.github.io/Heimat/').replace(/\/?$/, '/')
    const link = `${base}invite.html?t=${encodeURIComponent(p.invite)}`
    const who = p.inviter || 'Someone'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.resend_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: c.invite_from || 'Heimat <onboarding@resend.dev>',
        to: [p.email],
        subject: `${who} split an expense with you on Heimat`,
        html: body(p, link),
      }),
    })

    if (!res.ok) {
      // the invite row is already written; this only means the email bounced
      // off Resend, and the flat's code still works as a way in
      console.error('resend refused', res.status, await res.text())
      return new Response('send failed', { status: 200 })
    }
    return new Response('sent', { status: 200 })
  } catch (e) {
    console.error('invite function failed', e)
    return new Response('error', { status: 200 })
  }
})
