/* Firebase Cloud Messaging (HTTP v1) for the Android app. The service-account JSON
   from the Firebase console goes into the Supabase secret FCM_SERVICE_ACCOUNT (or,
   as before, app_config's `fcm_service_account`) — see logic.ts readPushConfig. */
import { signJwt } from './jwt.ts'
import { ANDROID_CHANNEL, fcmGone, fcmReasonText, thrownReasonText, transportOf } from './logic.ts'
import type { FcmServiceAccount } from './logic.ts'
import type { Notice, SendResult } from './apns.ts'

let cached: { token: string; expires: number; who: string } | null = null
// one exchange at a time: a notification to several phones at once asks Google once
let pending: { token: Promise<string>; who: string } | null = null

/* for tests: forget the cached access token */
export const resetFcmCache = () => { cached = null; pending = null }

/* Google answered the token exchange with an error (as opposed to no answer at all, or
   a key that couldn't even be used to sign) */
class TokenRefused extends Error {
  status: number
  constructor(status: number, error: string) {
    super(`token exchange ${status} ${error}`.trim())
    this.status = status
  }
}

const accessToken = (sa: FcmServiceAccount): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.who === sa.client_email && cached.expires - 60 > now) return Promise.resolve(cached.token)
  if (pending && pending.who === sa.client_email) return pending.token
  const mine = { token: exchange(sa, now), who: sa.client_email }
  pending = mine
  const done = () => { if (pending === mine) pending = null }
  mine.token.then(done, done)
  return mine.token
}

/* the usual two-step: sign a JWT as the service account, swap it for an access token */
const exchange = async (sa: FcmServiceAccount, now: number) => {
  const assertion = await signJwt('RS256', sa.private_key, {}, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    // e.g. {"error":"invalid_grant","error_description":"Invalid JWT Signature."} — no secrets in it
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new TokenRefused(res.status, j.error || '')
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number }
  cached = { token: json.access_token, expires: now + (json.expires_in || 3600), who: sa.client_email }
  return cached.token
}

/* what an Android phone is sent: shown by the system in the 'splitlife' channel (the app
   creates it, importance high) with the app's own status-bar icon */
export const fcmMessage = (deviceToken: string, n: Notice) => ({
  message: {
    token: deviceToken,
    notification: { title: n.title, body: n.body },
    android: {
      priority: 'HIGH',
      notification: {
        channel_id: ANDROID_CHANNEL,
        icon: 'ic_stat_heimat',
        color: '#3ddc97',
        ...(n.tag ? { tag: n.tag } : {}),
      },
    },
  },
})

/* endpoint is the whole stored address: 'fcm:<token>' */
export async function sendFcm(sa: FcmServiceAccount, endpoint: string, n: Notice): Promise<SendResult> {
  const t = transportOf(endpoint)
  if (t.kind !== 'fcm') return { ok: false, code: 'not-fcm', reason: "this isn't an Android address." }

  let bearer: string
  try {
    bearer = await accessToken(sa)
  } catch (e) {
    const err = e as Error
    // refused by Google: the key (or Google) is the problem; otherwise no answer, or a
    // key that can't be read — say which, rather than blame the key for a timeout
    const reason = err instanceof TokenRefused
      ? (err.status >= 500 || err.status === 429 ? fcmReasonText(err.status) : fcmReasonText(401, 'UNAUTHENTICATED'))
      : thrownReasonText('android', err?.name, err?.message)
    return { ok: false, gone: false, code: `oauth: ${err?.name || 'Error'} ${err?.message || 'failed'}`.slice(0, 120), reason }
  }

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(fcmMessage(t.token, n)),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return { ok: true, status: res.status }
  // the access token itself was refused (revoked, or the key changed): exchange again next time
  if (res.status === 401) cached = null
  const body = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; details?: { errorCode?: string }[] }
  }
  const status = body?.error?.status
  const errorCode = (body?.error?.details || []).map((d) => d?.errorCode).find(Boolean)
  return {
    ok: false,
    // the app was uninstalled, or FCM reissued the token
    gone: fcmGone(res.status, status, errorCode),
    status: res.status,
    code: errorCode || status || String(res.status),
    reason: fcmReasonText(res.status, status, errorCode),
  }
}
