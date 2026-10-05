/* Direct APNs delivery for the iOS app — no Firebase in the loop, so the app
   ships without the Firebase SDK and only needs its own APNs auth key.

   One .p8 key works for both of Apple's servers. A store/TestFlight build ('apns:')
   goes to the server the settings name (production unless APNS_ENV says otherwise); a
   build from Xcode ('apns-dev:') goes to the test server. If Apple says the token is
   bad, it is usually a token for the other server, so we try that once before giving
   up — and only a token both servers refuse, or one Apple says is unregistered, is
   forgotten. */
import { signJwt } from './jwt.ts'
import { apnsFirstAnswer, apnsHostFor, apnsReasonText, apnsSecondAnswer, otherApnsHost, transportOf } from './logic.ts'
import type { ApnsConfig, HttpAnswer } from './logic.ts'

export type { ApnsConfig } from './logic.ts'

export type SendResult = {
  ok: boolean
  gone?: boolean
  status?: number
  /* Apple's / Google's own word for what went wrong, for the log */
  code?: string
  /* the same in plain words, for a person testing */
  reason?: string
}

export type Notice = { title: string; body: string; tag?: string }

// Apple allows a provider token to be reused for up to an hour; minting one per
// notification gets you throttled with 429 TooManyProviderTokenUpdates. The promise is
// what is kept, so a notification to several iPhones at once mints one token, not one
// each; and the key itself is part of what it was made from, so a corrected key (same
// key id) is used from the next send instead of up to 45 minutes later.
let cached: { token: Promise<string>; at: number; key: string } | null = null

const providerToken = (cfg: ApnsConfig) => {
  const now = Math.floor(Date.now() / 1000)
  const key = `${cfg.team_id}.${cfg.key_id}.${cfg.private_key}`
  if (cached && cached.key === key && now - cached.at < 45 * 60) return cached.token
  const token = signJwt('ES256', cfg.private_key, { kid: cfg.key_id }, { iss: cfg.team_id, iat: now })
  const mine = { token, at: now, key }
  cached = mine
  // a key that can't be read: don't keep the failure
  token.catch(() => { if (cached === mine) cached = null })
  return token
}

/* for tests: forget the cached provider token */
export const resetApnsCache = () => { cached = null }

/* no badge: nothing in the app clears it again */
export const apnsPayload = (n: Notice) => ({ aps: { alert: { title: n.title, body: n.body }, sound: 'default' } })

async function post(cfg: ApnsConfig, host: string, deviceToken: string, n: Notice): Promise<HttpAnswer> {
  const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await providerToken(cfg)}`,
      'apns-topic': cfg.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(n.tag ? { 'apns-collapse-id': n.tag } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(apnsPayload(n)),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return { status: res.status }
  const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason
  // Apple refused the token itself: mint a fresh one next time rather than keep sending it
  if (res.status === 403 && (reason === 'InvalidProviderToken' || reason === 'ExpiredProviderToken')) cached = null
  return { status: res.status, reason }
}

const failed = (a: HttpAnswer, gone = false): SendResult =>
  ({ ok: false, gone, status: a.status, code: a.reason || String(a.status), reason: apnsReasonText(a.status, a.reason) })

/* endpoint is the whole stored address: 'apns:<hex>' or 'apns-dev:<hex>' */
export async function sendApns(cfg: ApnsConfig, endpoint: string, n: Notice): Promise<SendResult> {
  const t = transportOf(endpoint)
  if (t.kind !== 'apns') return { ok: false, code: 'not-apns', reason: "this isn't an iPhone address." }
  const host = apnsHostFor(endpoint, cfg)

  const first = await post(cfg, host, t.token, n)
  const next = apnsFirstAnswer(first)
  if (next === 'ok') return { ok: true, status: first.status }
  if (next === 'gone') return failed(first, true)
  if (next === 'fail') return failed(first)

  // BadDeviceToken: a token for Apple's other server?
  let second: HttpAnswer
  try {
    second = await post(cfg, otherApnsHost(host), t.token, n)
  } catch (e) {
    // the other server couldn't be reached: we don't know the token is bad, so keep it
    return { ...failed(first), code: `BadDeviceToken+${(e as Error)?.name || 'error'}` }
  }
  const after = apnsSecondAnswer(second)
  if (after === 'ok') return { ok: true, status: second.status, code: 'other-server' }
  return failed(second, after === 'gone')
}
