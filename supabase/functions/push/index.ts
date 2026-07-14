// Sends web-push notifications. Called by database triggers (see the push_notify_* triggers),
// never by the client. Auth is a shared token stored in app_config, checked below.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Payload = {
  token: string
  event: 'item_added' | 'settlement' | 'expense_added' | 'broadcast'
  flat_id?: string
  actor?: string          // who did it — never notified
  to_user?: string        // settlement recipient
  title?: string          // list item title / broadcast heading
  amount?: number
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

Deno.serve(async (req) => {
  try {
    const body = (await req.json()) as Payload
    const c = await cfg()

    if (!c.push_token || body.token !== c.push_token) {
      return new Response('unauthorized', { status: 401 })
    }

    webpush.setVapidDetails(c.vapid_subject || 'mailto:noreply@heimat.app', c.vapid_public, c.vapid_private)

    const members = async (flatId: string) => {
      const { data } = await admin.from('flat_members').select('user_id').eq('flat_id', flatId)
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
    } else if (body.event === 'expense_added' && body.flat_id && body.actor) {
      const who = await nameOf(body.actor, body.flat_id)
      const parts = body.split_among || []
      const share = parts.length ? Number(body.amount || 0) / parts.length : 0
      recipients = (await members(body.flat_id)).filter((u) => u !== body.actor)
      title = body.description || 'New shared expense'
      // each flatmate sees their own share of it
      bodyFor = (uid) =>
        `${who} added ${euro(Number(body.amount || 0))}` + (parts.includes(uid) ? ` · you owe ${euro(share)}` : '')
    } else if (body.event === 'settlement' && body.to_user && body.actor && body.flat_id) {
      if (body.to_user === body.actor) return Response.json({ sent: 0, skipped: 'self' })
      const who = await nameOf(body.actor, body.flat_id)
      recipients = [body.to_user]
      title = 'Payment recorded'
      bodyFor = () => `${who} paid you ${euro(Number(body.amount || 0))}`
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

    let sent = 0
    const dead: string[] = []

    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body: bodyFor(s.user_id), url: './', tag: body.event })
          )
          sent++
        } catch (e: any) {
          // 404/410 mean the browser threw the subscription away — drop it
          if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint)
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
