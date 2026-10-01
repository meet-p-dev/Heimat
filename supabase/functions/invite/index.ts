// Emails someone who has been added to a flat or a group but isn't on Heimat
// yet, so they know a bill is waiting and where to claim it — or, for an
// expense between friends (kind 'direct'), what was added and their part of it.
// Called by the member_invited and friend_expense_invites triggers, never by the
// client — auth is the same shared token in app_config that the push function uses.
//
// Two ways out, chosen by what is in app_config, so neither the code nor a
// redeploy is involved in switching:
//
//   SMTP   `smtp_user` + `smtp_pass` set. Sends through an ordinary mailbox —
//          Gmail with an app password, at the time of writing. Reaches anybody
//          and needs no domain, but the invite arrives from a personal address.
//   Resend `resend_key` set. Better looking and better delivered, but until a
//          domain is verified it refuses every recipient except the account's
//          own address, with a 403.
//
// SMTP wins when both are set. With neither, the function says so and returns
// 200: the invite itself is already saved, and the flat's code still works as
// a way in. It always returns 200 for the same reason — a failed send must
// never roll back the invite that triggered it. What actually happened is
// written back onto the member row instead, so the app can say so.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Payload = {
  token: string
  event: 'invited'
  email: string
  name?: string
  invite: string
  flat?: string
  kind?: 'flat' | 'group' | 'direct'
  inviter?: string
  /* kind 'direct': the expense that brought them in. share and paid are in the
     currency's minor units (cents for euros), as the database stored them */
  description?: string
  amount?: number
  currency?: string
  share?: number
  paid?: number
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const cfg = async (): Promise<Record<string, string>> => {
  const { data } = await admin.from('app_config').select('key,value')
  return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]))
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ISO 4217 minor-unit exponents: 2, except these (the same table as src/lib/ledger.ts)
const DIGITS: Record<string, number> = Object.fromEntries([
  ...'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'.split(' ').map((c) => [c, 0]),
  ...'BHD IQD JOD KWD LYD OMR TND'.split(' ').map((c) => [c, 3]),
])
const minorDigits = (cur?: string) => DIGITS[(cur || '').toUpperCase()] ?? 2

// the German way, as the push notifications write it (12,50 €, 1.200 ¥)
const money = (n: number, cur?: string) => {
  const c = (cur || 'EUR').toUpperCase()
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: c }).format(n)
  } catch {
    return `${n.toFixed(minorDigits(c)).replace('.', ',')} ${c}`
  }
}

// What the expense does to them, in one line: "Your share: 15,00 €" or, when
// they paid, "You paid 30,00 € — 15,00 € of it is coming back to you".
const yourPart = (p: Payload) => {
  const scale = 10 ** minorDigits(p.currency)
  const share = Number(p.share || 0)
  const paid = Number(p.paid || 0)
  if (!paid) return `Your share: ${money(share / scale, p.currency)}`
  const net = paid - share
  return net > 0
    ? `You paid ${money(paid / scale, p.currency)} — ${money(net / scale, p.currency)} of it is coming back to you`
    : net < 0
      ? `You paid ${money(paid / scale, p.currency)} and owe ${money(-net / scale, p.currency)} more`
      : `You paid ${money(paid / scale, p.currency)}, which is exactly your share`
}

const directHtml = (p: Payload, link: string) => {
  const who = esc(p.inviter || 'Someone')
  const what = esc(p.description || 'An expense')
  return `<!DOCTYPE html><html><body style="margin:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:440px;margin:0 auto;padding:32px 20px">
  <div style="background:#fff;border-radius:22px;padding:28px 24px">
    <h1 style="font-size:21px;margin:0 0 12px;color:#0c1110;letter-spacing:-.3px">${who} added an expense with you</h1>
    <div style="border:1px solid #e3e9e6;border-radius:14px;padding:14px 16px;margin:0 0 18px">
      <div style="font-size:16px;font-weight:600;color:#0c1110">${what}</div>
      <div style="font-size:14px;color:#5d6b65;margin-top:2px">${esc(money(Number(p.amount || 0), p.currency))} in all</div>
      <div style="font-size:15px;color:#0b6b4f;font-weight:600;margin-top:10px">${esc(yourPart(p))}</div>
    </div>
    <p style="font-size:15px;line-height:1.55;color:#5d6b65;margin:0 0 22px">
      ${who} keeps track of what you share on Splitlife, a small app for splitting costs with friends and flatmates.
    </p>
    <a href="${link}" style="display:block;text-align:center;background:#0b6b4f;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px;border-radius:14px">See it on Splitlife</a>
    <p style="font-size:13px;line-height:1.5;color:#8b968f;margin:18px 0 0">
      Sign up with this email address and everything they split with you will be waiting. If you don't know ${who}, ignore this — nothing is shared with you until you do.
    </p>
  </div>
</div></body></html>`
}

const directPlain = (p: Payload, link: string) =>
  `${p.inviter || 'Someone'} added an expense with you on Splitlife.\n\n` +
  `${p.description || 'An expense'}: ${money(Number(p.amount || 0), p.currency)} in all\n${yourPart(p)}\n\n` +
  `See it here:\n${link}\n\n` +
  `Sign up with this email address and everything they split with you will be waiting. If you don't know them, ignore this.`

const html = (p: Payload, link: string) => {
  const who = esc(p.inviter || 'Someone')
  const place = esc(p.flat || (p.kind === 'flat' ? 'their flat' : 'their group'))
  const noun = p.kind === 'flat' ? 'flat' : 'group'
  return `<!DOCTYPE html><html><body style="margin:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:440px;margin:0 auto;padding:32px 20px">
  <div style="background:#fff;border-radius:22px;padding:28px 24px">
    <h1 style="font-size:21px;margin:0 0 12px;color:#0c1110;letter-spacing:-.3px">${who} split an expense with you</h1>
    <p style="font-size:15px;line-height:1.55;color:#5d6b65;margin:0 0 22px">
      You've been added to the ${noun} <strong style="color:#0c1110">${place}</strong> on Splitlife, a small app for sharing flat and trip costs.
      Your share is already counted — open the link to see what it is.
    </p>
    <a href="${link}" style="display:block;text-align:center;background:#0b6b4f;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px;border-radius:14px">See the expense</a>
    <p style="font-size:13px;line-height:1.5;color:#8b968f;margin:18px 0 0">
      Sign up with this email address and it'll be waiting for you. If you weren't expecting this, ignore it — nothing is shared with you until you do.
    </p>
  </div>
</div></body></html>`
}

const plain = (p: Payload, link: string) =>
  `${p.inviter || 'Someone'} added you to ${p.flat || 'a group'} on Splitlife and split an expense with you.\n\n` +
  `Your share is already counted. Open this to see it:\n${link}\n\n` +
  `Sign up with this email address and it will be waiting for you. If you weren't expecting this, ignore it.`

Deno.serve(async (req) => {
  try {
    const p = (await req.json()) as Payload
    const c = await cfg()

    if (!c.push_token || p.token !== c.push_token) {
      return new Response('unauthorized', { status: 401 })
    }
    if (!p.email || !p.invite) return new Response('nothing to send', { status: 200 })

    // The app shows whatever lands here, so it has to be the truth rather than
    // a hope: a refused send must still say so, and must still not fail.
    const record = async (error: string | null) => {
      await admin
        .from('flat_members')
        .update({ invite_sent_at: error ? null : new Date().toISOString(), invite_error: error })
        .eq('invite_token', p.invite)
    }

    const base = (c.public_url || 'https://meet-p-dev.github.io/Heimat/').replace(/\/?$/, '/')
    const link = `${base}invite.html?t=${encodeURIComponent(p.invite)}`
    const direct = p.kind === 'direct'
    const subject = direct
      ? `${p.inviter || 'Someone'} added “${p.description || 'an expense'}” with you on Splitlife`
      : `${p.inviter || 'Someone'} split an expense with you on Splitlife`
    const body = direct ? directHtml(p, link) : html(p, link)
    const text = direct ? directPlain(p, link) : plain(p, link)

    if (c.smtp_user && c.smtp_pass) {
      // Google shows an app password in four blocks of four; people paste it
      // exactly as shown, and it fails authentication with the spaces in.
      const pass = c.smtp_pass.replace(/\s+/g, '')
      const client = new SMTPClient({
        connection: {
          hostname: c.smtp_host || 'smtp.gmail.com',
          port: Number(c.smtp_port || '465'),
          tls: true,
          auth: { username: c.smtp_user, password: pass },
        },
      })
      try {
        await client.send({
          from: c.invite_from || c.smtp_user,
          to: p.email,
          subject,
          content: text,
          html: body,
        })
      } catch (e) {
        await client.close()
        const why = e instanceof Error ? e.message : String(e)
        console.error('smtp refused', why)
        await record(why.slice(0, 300))
        return new Response('send failed', { status: 200 })
      }
      await client.close()
      await record(null)
      return new Response('sent via smtp', { status: 200 })
    }

    if (c.resend_key) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.resend_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: c.invite_from || 'Splitlife <onboarding@resend.dev>',
          to: [p.email],
          subject,
          html: body,
          text,
        }),
      })
      if (!res.ok) {
        const why = await res.text()
        console.error('resend refused', res.status, why)
        // Resend's own wording is the clearest explanation there is, and the
        // person reading it in the app is the one who can act on it
        let msg = why
        try { msg = JSON.parse(why).message || why } catch { /* keep the raw body */ }
        await record(msg.slice(0, 300))
        return new Response('send failed', { status: 200 })
      }
      await record(null)
      return new Response('sent via resend', { status: 200 })
    }

    await record('No email is set up yet — share the link instead.')
    return new Response('no mail transport configured — invite saved, email skipped', { status: 200 })
  } catch (e) {
    console.error('invite function failed', e)
    return new Response('error', { status: 200 })
  }
})
