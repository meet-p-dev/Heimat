// Sends notifications to every device a flatmate has: browsers over web push,
// the iOS app over APNs and the Android app over FCM. Which transport a row uses
// is written into its `endpoint` — a URL for the web, `apns:`/`fcm:` + the device
// token for the apps. Called by database triggers (see the push_notify_* triggers),
// never by the client. Auth is a shared token stored in app_config, checked below.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { apnsConfig, sendApns } from './apns.ts'
import { fcmConfig, sendFcm } from './fcm.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Payload = {
  token: string
  event: 'item_added' | 'settlement' | 'expense_added' | 'nudge' | 'broadcast'
  flat_id?: string
  actor?: string          // who did it — never notified
  to_user?: string        // settlement recipient
  paid_by?: string        // who put the money down, who may not be in the split
  title?: string          // list item title / broadcast heading
  amount?: number
  /* the amount's currency (ISO 4217); absent from older triggers, which meant euros */
  currency?: string
  /* expense_added: user id → share in the currency's minor units (cents for euros), as
     the database stored it — everyone in the split is listed, 0 included */
  shares?: Record<string, number>
  /* expense_added: minor units each person paid, when several did; absent or null = paid_by paid it all */
  payers?: Record<string, number> | null
  description?: string    // expense description
  split_among?: string[]  // expense split, to work out each person's share
  message?: string        // broadcast body
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const cfg = async (): Promise<Record<string, string>> => {
  const { data } = await admin.from('app_config').select('key,value')
  return Object.fromEntries((data || []).map((r: any) => [r.key, r.value]))
}

const nameOf = async (uid: string, flatId: string) => {
  const { data } = await admin.from('flat_members').select('display_name').eq('flat_id', flatId).eq('user_id', uid).maybeSingle()
  return data?.display_name || 'A flatmate'
}

const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`

// ISO 4217 minor-unit exponents: 2, except these (the same table as src/lib/ledger.ts)
const DIGITS: Record<string, number> = Object.fromEntries([
  ...'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'.split(' ').map((c) => [c, 0]),
  ...'BHD IQD JOD KWD LYD OMR TND'.split(' ').map((c) => [c, 3]),
])
const minorDigits = (cur?: string) => DIGITS[(cur || '').toUpperCase()] ?? 2

// euros as the apps write them (12,50 €); any other currency the German way too (12,50 CHF, 1.200 ¥)
const money = (n: number, cur?: string) => {
  const c = (cur || 'EUR').toUpperCase()
  if (c === 'EUR') return euro(n)
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: c }).format(n)
  } catch {
    return `${n.toFixed(minorDigits(c)).replace('.', ',')} ${c}`
  }
}

Deno.serve(async (req) => {
  try {
    const body = (await req.json()) as Payload
    const c = await cfg()

    if (!c.push_token || body.token !== c.push_token) {
      return new Response('unauthorized', { status: 401 })
    }

    if (c.vapid_public && c.vapid_private) {
      webpush.setVapidDetails(c.vapid_subject || 'mailto:noreply@heimat.app', c.vapid_public, c.vapid_private)
    }

    // the people in the flat now: not those who left, not invitees who haven't joined
    const members = async (flatId: string) => {
      const { data } = await admin.from('flat_members').select('user_id').eq('flat_id', flatId)
        .is('left_at', null).not('claimed_at', 'is', null)
      return (data || []).map((m: any) => m.user_id as string)
    }

    // work out who to notify, and what each of them should read
    let title = 'Heimat'
    let recipients: string[] = []
    let bodyFor: (uid: string) => string = () => ''

    if (body.event === 'item_added' && body.flat_id && body.actor) {
      const who = await nameOf(body.actor, body.flat_id)
      recipients = (await members(body.flat_id)).filter((u) => u !== body.actor)
      title = 'Shopping list'
      bodyFor = () => `${who} added “${body.title}”`
    } else if (body.event === 'expense_added' && body.flat_id) {
      // no actor: a recurring expense whose author has since deleted their account
      const who = body.actor ? await nameOf(body.actor, body.flat_id) : 'Heimat'
      const parts = body.split_among || []
      // each person's share, split by the database exactly as the apps split it
      // (10 € between three is 3,34 + 3,33 + 3,33; by percentage, shares or items
      // it is whatever the split says), in the expense's own currency. Someone
      // missing from the shares owes nothing; an even division is only the
      // fallback for a payload from before shares were sent at all
      const scale = 10 ** minorDigits(body.currency)
      const shareOf = (uid: string) =>
        body.shares ? Number(body.shares[uid] ?? 0) / scale : parts.length ? Number(body.amount || 0) / parts.length : 0
      // Only the people the expense is actually about: whoever it is split
      // between, plus whoever paid — they may not be in the split, and it is
      // still their money. An empty split means the payer alone, which is the
      // app's convention and means nobody else needs telling.
      const involved = new Set<string>(parts)
      if (body.paid_by) involved.add(body.paid_by)
      for (const k of Object.keys(body.payers ?? {})) involved.add(k)
      const inFlat = await members(body.flat_id)
      recipients = inFlat.filter((u) => u !== body.actor && involved.has(u))
      title = body.description || 'New shared expense'
      // each of them sees what it does to them: what they paid (several payers, or
      // paid_by alone), in minor units, against their share
      const amountMinor = Math.round(Number(body.amount || 0) * scale)
      const paidOf = (uid: string) => body.payers ? Number(body.payers[uid] ?? 0) : uid === body.paid_by ? amountMinor : 0
      bodyFor = (uid) => {
        const share = parts.includes(uid) ? Math.round(shareOf(uid) * scale) : 0
        const paid = paidOf(uid)
        // what the expense does to their balance: what they paid minus their share (the
        // payer gets the others' shares back; a co-payer who put in less still owes the rest)
        const net = paid - share
        return `${who} added ${money(Number(body.amount || 0), body.currency)}` +
          (net < 0 ? ` · you owe ${money(-net / scale, body.currency)}`
            : net > 0 ? ` · you get ${money(net / scale, body.currency)} back`
            : paid !== 0 ? ' · you paid' : '')
      }
    } else if (body.event === 'settlement' && body.to_user && body.actor && body.flat_id) {
      if (body.to_user === body.actor) return Response.json({ sent: 0, skipped: 'self' })
      const who = await nameOf(body.actor, body.flat_id)
      recipients = [body.to_user]
      title = 'Payment recorded'
      bodyFor = () => `${who} paid you ${money(Number(body.amount || 0), body.currency)}`
    } else if (body.event === 'nudge' && body.to_user && body.actor && body.flat_id) {
      // one person, on purpose: a reminder is a private thing
      const who = await nameOf(body.actor, body.flat_id)
      recipients = [body.to_user]
      title = 'A nudge from ' + who
      bodyFor = () => `${who} is still waiting on ${money(Number(body.amount || 0), body.currency)}`
    } else if (body.event === 'broadcast' && body.flat_id) {
      recipients = await members(body.flat_id)
      title = body.title || 'Heimat'
      bodyFor = () => body.message || ''
    } else {
      return new Response('bad request', { status: 400 })
    }

    if (!recipients.length) return Response.json({ sent: 0 })

    const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', recipients)
    if (!subs?.length) return Response.json({ sent: 0, reason: 'no subscriptions' })

    const apns = apnsConfig(c)
    const fcm = fcmConfig(c)

    let sent = 0
    const dead: string[] = []

    await Promise.all(
      subs.map(async (s: any) => {
        const endpoint = s.endpoint as string
        const text = bodyFor(s.user_id)
        try {
          if (endpoint.startsWith('apns:')) {
            if (!apns) return console.warn('ios device but APNs is not configured')
            const r = await sendApns(apns, endpoint.slice(5), { title, body: text, tag: body.event })
            if (r.ok) sent++
            else if (r.gone) dead.push(endpoint)
            else console.error('apns failed', r.status, r.reason)
            return
          }
          if (endpoint.startsWith('fcm:')) {
            if (!fcm) return console.warn('android device but FCM is not configured')
            const r = await sendFcm(fcm, endpoint.slice(4), { title, body: text, tag: body.event })
            if (r.ok) sent++
            else if (r.gone) dead.push(endpoint)
            else console.error('fcm failed', r.status, r.reason)
            return
          }
          await webpush.sendNotification(
            { endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body: text, url: './', tag: body.event })
          )
          sent++
        } catch (e: any) {
          // 404/410 mean the browser threw the subscription away — drop it
          if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(endpoint)
          else console.error('push failed', e?.statusCode, e?.body || e?.message)
        }
      })
    )

    if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)

    return Response.json({ sent, pruned: dead.length, recipients: recipients.length })
  } catch (e) {
    console.error(e)
    return new Response('error', { status: 500 })
  }
})
