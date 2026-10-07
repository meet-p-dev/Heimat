// Sends notifications to every device a flatmate has: browsers over web push,
// the iOS app over APNs and the Android app over FCM. Which transport a row uses
// is written into its `endpoint` — a URL for the web, `apns:`/`apns-dev:`/`fcm:` +
// the device token for the apps (see logic.ts transportOf).
//
// Two ways in:
//  - database triggers (push_notify_* and the reminder functions) post an event with
//    the shared token from app_config, checked below — unchanged;
//  - the apps' "Send a test notification" button posts { event: 'test' } with the
//    signed-in person's own access token (supabase.functions.invoke adds it). That
//    sends one test notification to that person's own devices only, and answers
//    what happened on each, so a person can see for themselves whether it works.
//
// The APNs and FCM keys are read from the function's secrets (APNS_KEY_ID,
// APNS_PRIVATE_KEY, APNS_TEAM_ID, APNS_TOPIC, APNS_ENV, FCM_SERVICE_ACCOUNT) and
// otherwise from app_config. Every request writes one summary line to the log.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { sendApns } from './apns.ts'
import type { Notice } from './apns.ts'
import { sendFcm } from './fcm.ts'
import {
  NOT_CONFIGURED, TEST_BODY, TEST_TITLE, deviceHint, readPushConfig, summaryLine, thrownReasonText, transportOf, webGone,
  webReasonText,
} from './logic.ts'
import type { DeviceResult, PushConfig } from './logic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Payload = {
  token: string
  event: 'item_added' | 'settlement' | 'expense_added' | 'nudge' | 'broadcast' | 'reminder' | 'test' | 'app_update'
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
  platform?: string       // app_update: which app has a new build ('ios')
  build?: number          // app_update: the new build's number
}

type Sub = { endpoint: string; user_id: string; p256dh: string | null; auth: string | null }

// browsers call the test; the database triggers don't care either way
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

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

const configuredOf = (conf: PushConfig) => ({ apns: !!conf.apns, fcm: !!conf.fcm, web: !!conf.web })

/* one device, whatever it is; never throws */
async function deliver(conf: PushConfig, s: Sub, n: Notice): Promise<DeviceResult> {
  const t = transportOf(s.endpoint)
  const hint = deviceHint(s.endpoint)
  try {
    if (t.kind === 'apns') {
      if (!conf.apns) return { platform: 'ios', ok: false, reason: NOT_CONFIGURED.ios, code: 'not-configured', hint }
      const r = await sendApns(conf.apns, s.endpoint, n)
      return { platform: 'ios', ok: r.ok, gone: r.gone, reason: r.ok ? undefined : r.reason, code: r.code, hint }
    }
    if (t.kind === 'fcm') {
      if (!conf.fcm) return { platform: 'android', ok: false, reason: NOT_CONFIGURED.android, code: 'not-configured', hint }
      const r = await sendFcm(conf.fcm, s.endpoint, n)
      return { platform: 'android', ok: r.ok, gone: r.gone, reason: r.ok ? undefined : r.reason, code: r.code, hint }
    }
    if (!conf.web) return { platform: 'web', ok: false, reason: NOT_CONFIGURED.web, code: 'not-configured', hint }
    if (!s.p256dh || !s.auth) {
      return { platform: 'web', ok: false, reason: "this browser's notification sign-up is incomplete. Turn notifications off and on again.", code: 'no-keys', hint }
    }
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ title: n.title, body: n.body, url: './', ...(n.tag ? { tag: n.tag } : {}) }),
      { vapidDetails: { subject: conf.web.subject, publicKey: conf.web.public_key, privateKey: conf.web.private_key }, timeout: 10_000 },
    )
    return { platform: 'web', ok: true, hint }
  } catch (e: any) {
    if (t.kind === 'web' && typeof e?.statusCode === 'number') {
      // 404/410 mean the browser threw the subscription away
      return { platform: 'web', ok: false, gone: webGone(e.statusCode), reason: webReasonText(e.statusCode), code: String(e.statusCode), hint }
    }
    // no answer at all (timeout, network), or a key that can't be read
    return { platform: t.platform, ok: false, reason: thrownReasonText(t.platform, e?.name, e?.message), code: String(e?.name || 'error'), hint }
  }
}

/* send to every device of these rows, forget the ones that are gone */
async function deliverAll(conf: PushConfig, subs: Sub[], notice: (s: Sub) => Notice) {
  const results = await Promise.all(subs.map((s) => deliver(conf, s, notice(s))))
  const dead = subs.filter((_, i) => results[i].gone).map((s) => s.endpoint)
  if (dead.length) {
    const { error } = await admin.from('push_subscriptions').delete().in('endpoint', dead)
    if (error) console.error('could not forget gone devices', error.message)
  }
  return { results, pruned: dead.length }
}

/* the apps' test button: the signed-in person's own devices, and what happened on each */
async function test(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ error: 'not signed in' }, 401)
  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data?.user) return json({ error: 'not signed in' }, 401)

  const conf = readPushConfig((name) => Deno.env.get(name), await cfg())
  const { data: rows, error: e2 } = await admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').eq('user_id', data.user.id)
  if (e2) throw e2
  const subs = (rows || []) as Sub[]
  const configured = configuredOf(conf)
  const { results } = await deliverAll(conf, subs, () => ({ title: TEST_TITLE, body: TEST_BODY, tag: 'test' }))
  const sent = results.filter((r) => r.ok).length
  console.log(summaryLine('test', 1, results, configured, conf.problems))
  return json({
    configured,
    devices: results.map((r) => (r.ok ? { platform: r.platform, ok: true } : { platform: r.platform, ok: false, reason: r.reason })),
    sent,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let event = '?'
  try {
    const body = (await req.json().catch(() => null)) as Payload | null
    if (!body || typeof body !== 'object') return json({ error: 'bad request' }, 400)
    event = String(body.event).slice(0, 40)
    if (body.event === 'test') return await test(req)

    const c = await cfg()
    if (!c.push_token || body.token !== c.push_token) {
      // a database trigger with the wrong token would otherwise fail without a trace
      console.log(JSON.stringify({ push: event, refused: c.push_token ? 'wrong token' : 'push_token not set' }))
      return new Response('unauthorized', { status: 401 })
    }
    const conf = readPushConfig((name) => Deno.env.get(name), c)

    const configured = configuredOf(conf)
    const done = (recipients: number, extra: Record<string, unknown>, note?: string) => {
      console.log(summaryLine(event, recipients, [], configured, conf.problems, note))
      return Response.json(extra)
    }

    // A new build for the testers (announce_app_update): every iPhone running the
    // TestFlight / App Store app — 'apns:', not the Xcode builds' 'apns-dev:' — and
    // tapping it opens TestFlight. Whoever has updated already never sees the app's
    // Update card; the notification itself can't know who has.
    if (body.event === 'app_update') {
      const build = Number(body.build)
      if (body.platform !== 'ios' || !Number.isInteger(build) || build < 1) {
        console.log(summaryLine(event, 0, [], configured, [], 'bad request'))
        return new Response('bad request', { status: 400 })
      }
      const url = c.ios_update_url || 'itms-beta://'
      const { data: subs, error } = await admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').like('endpoint', 'apns:%')
      if (error) throw error
      if (!subs?.length) return done(0, { sent: 0, reason: 'no subscriptions' }, 'no devices')
      const notice: Notice = { title: 'New update available', body: `Splitlife build ${build} is ready — update it in TestFlight.`, tag: 'app_update', url }
      const { results, pruned } = await deliverAll(conf, subs as Sub[], () => notice)
      const sent = results.filter((r) => r.ok).length
      const people = new Set((subs as Sub[]).map((s) => s.user_id)).size
      console.log(summaryLine(event, people, results, configured, conf.problems))
      return Response.json({ sent, pruned, failed: results.length - sent, recipients: people })
    }

    // the people in the flat now: not those who left, not invitees who haven't joined
    const members = async (flatId: string) => {
      const { data } = await admin.from('flat_members').select('user_id').eq('flat_id', flatId)
        .is('left_at', null).not('claimed_at', 'is', null)
      return (data || []).map((m: any) => m.user_id as string)
    }

    // work out who to notify, and what each of them should read
    let title = 'Splitlife'
    let recipients: string[] = []
    let bodyFor: (uid: string) => string = () => ''

    if (body.event === 'item_added' && body.flat_id && body.actor) {
      const who = await nameOf(body.actor, body.flat_id)
      recipients = (await members(body.flat_id)).filter((u) => u !== body.actor)
      title = 'Shopping list'
      bodyFor = () => `${who} added “${body.title}”`
    } else if (body.event === 'expense_added' && body.flat_id) {
      // no actor: a recurring expense whose author has since deleted their account
      const who = body.actor ? await nameOf(body.actor, body.flat_id) : 'Splitlife'
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
      if (body.to_user === body.actor) return done(0, { sent: 0, skipped: 'self' }, 'self')
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
    } else if (body.event === 'reminder' && body.to_user) {
      // bills due, contracts to cancel, chore turns and swaps: one person, written by
      // the database (run_reminders and the chore functions); flat_id is null for a
      // personal bill
      recipients = [body.to_user]
      title = body.title || 'Splitlife'
      bodyFor = () => body.message || ''
    } else if (body.event === 'broadcast' && body.flat_id) {
      recipients = await members(body.flat_id)
      title = body.title || 'Splitlife'
      bodyFor = () => body.message || ''
    } else {
      console.log(summaryLine(event, 0, [], configured, [], 'bad request'))
      return new Response('bad request', { status: 400 })
    }

    if (!recipients.length) return done(0, { sent: 0 })

    const { data: subs } = await admin.from('push_subscriptions').select('endpoint,user_id,p256dh,auth').in('user_id', recipients)
    if (!subs?.length) return done(recipients.length, { sent: 0, reason: 'no subscriptions' }, 'no devices')

    // one tag per kind replaces the last of that kind on the lock screen; reminders are
    // each their own (rent today must not replace your chore turn)
    const tag = body.event === 'reminder' ? undefined : body.event

    const { results, pruned } = await deliverAll(conf, subs as Sub[], (s) => ({ title, body: bodyFor(s.user_id), tag }))
    const sent = results.filter((r) => r.ok).length
    console.log(summaryLine(event, recipients.length, results, configured, conf.problems))

    return Response.json({ sent, pruned, failed: results.length - sent, recipients: recipients.length })
  } catch (e) {
    console.error(JSON.stringify({ push: event, error: String((e as Error)?.message || e).slice(0, 300) }))
    return json({ error: 'error' }, 500)
  }
})
