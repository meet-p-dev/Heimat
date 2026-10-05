/* The parts of the push sender that are plain decisions — no network, no database, no
   npm:/jsr: imports — so they run under Node in tests/push-logic.test.ts as well as in
   the edge function:

   - reading the server settings (Supabase secrets first, then app_config)
   - tidying a private key however it was pasted
   - which device address goes to which service, and to which Apple server
   - when a device is really gone, and when to try Apple's other server
   - the plain words a person sees when a test notification can't be delivered */

export type Platform = 'ios' | 'android' | 'web'

export type ApnsConfig = {
  key_id: string
  team_id: string
  private_key: string // contents of the .p8 file, PEM
  topic: string       // the bundle id, app.heimat.mobile
  production: boolean
}

export type FcmServiceAccount = { project_id: string; client_email: string; private_key: string }

export type WebConfig = { public_key: string; private_key: string; subject: string }

export type PushConfig = {
  apns: ApnsConfig | null
  fcm: FcmServiceAccount | null
  web: WebConfig | null
  /* what is missing or broken, for the log — names of settings, never their values */
  problems: string[]
}

export const APNS_HOST = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' } as const
export const ANDROID_CHANNEL = 'splitlife'

export const TEST_TITLE = 'Splitlife'
export const TEST_BODY = 'Test notification — notifications work on this device.'

/* ---------- settings ---------- */

const clean = (v: string | null | undefined) => {
  if (v == null) return ''
  let s = String(v).trim()
  // pasted with its quotes
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) s = s.slice(1, -1).trim()
  return s
}

/* A private key in PEM, however it was pasted: real newlines, the two characters "\n"
   (as it comes out of a .env file or a JSON string escaped twice), spaces instead of
   newlines, Windows line ends, surrounding quotes, or just the base64 middle without
   its BEGIN/END lines. Returns a tidy PEM with 64-character lines, or '' when there is
   nothing that could be a key. */
export function normalizePem(raw: string | null | undefined): string {
  let s = clean(raw)
  if (!s) return ''
  // "\n" written out once or more (escaped twice gives "\\n"), and "\/" from a JSON
  // encoder that escapes slashes — a '/' is part of the key, so it must stay
  s = s.replace(/\\+r/g, '').replace(/\\+n/g, '\n').replace(/\\+\//g, '/').replace(/\r/g, '')
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/)
  const label = m ? m[1] : 'PRIVATE KEY'
  const body = (m ? m[2] : s).replace(/\\./g, '').replace(/\s+/g, '')
  // a key is DER in base64: whole 4-character groups, and longer than a few words
  if (body.length < 64 || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return ''
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/* the base64 inside a PEM — what crypto.subtle wants, once decoded */
export function pemBody(pem: string): string {
  const tidy = normalizePem(pem)
  if (!tidy) throw new Error('the private key is empty or not a key')
  return tidy.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
}

/* the Firebase service-account JSON, pasted as JSON or as base64 of the JSON */
export function parseServiceAccount(raw: string | null | undefined): { sa: FcmServiceAccount | null; problem?: string } {
  const s = clean(raw)
  if (!s) return { sa: null }
  let text = s
  if (!s.startsWith('{')) {
    try {
      text = atob(s.replace(/\s+/g, ''))
    } catch {
      return { sa: null, problem: 'FCM_SERVICE_ACCOUNT is not JSON' }
    }
  }
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    return { sa: null, problem: 'FCM_SERVICE_ACCOUNT is not JSON' }
  }
  const missing = ['project_id', 'client_email', 'private_key'].filter((k) => !j || typeof j[k] !== 'string' || !j[k].trim())
  if (missing.length) return { sa: null, problem: `FCM_SERVICE_ACCOUNT lacks ${missing.join(', ')}` }
  const private_key = normalizePem(j.private_key)
  if (!private_key) return { sa: null, problem: 'FCM_SERVICE_ACCOUNT private_key is not a key' }
  return { sa: { project_id: j.project_id.trim(), client_email: j.client_email.trim(), private_key } }
}

const isSandbox = (env: string) => /^(dev|sandbox)/i.test(env)

/* Supabase Edge Function secrets win; the app_config table is the fallback (where the
   web-push keys already live). */
export function readPushConfig(env: (name: string) => string | undefined, appConfig: Record<string, string>): PushConfig {
  const pick = (envName: string, cfgKey: string, fallback = '') => clean(env(envName)) || clean(appConfig[cfgKey]) || fallback
  const problems: string[] = []

  let apns: ApnsConfig | null = null
  const key_id = pick('APNS_KEY_ID', 'apns_key_id')
  const rawKey = pick('APNS_PRIVATE_KEY', 'apns_private_key')
  const private_key = normalizePem(rawKey)
  if (key_id && private_key) {
    apns = {
      key_id,
      private_key,
      team_id: pick('APNS_TEAM_ID', 'apns_team_id', 'Q3BTHLU74C'),
      topic: pick('APNS_TOPIC', 'apns_topic', 'app.heimat.mobile'),
      production: !isSandbox(pick('APNS_ENV', 'apns_env', 'production')),
    }
  } else if (key_id || rawKey) {
    problems.push(!key_id ? 'APNS_KEY_ID is missing' : rawKey ? 'APNS_PRIVATE_KEY is not a key' : 'APNS_PRIVATE_KEY is missing')
  } else {
    problems.push('APNs is not set up (APNS_KEY_ID, APNS_PRIVATE_KEY)')
  }

  const { sa, problem } = parseServiceAccount(pick('FCM_SERVICE_ACCOUNT', 'fcm_service_account'))
  if (problem) problems.push(problem)
  else if (!sa) problems.push('FCM is not set up (FCM_SERVICE_ACCOUNT)')

  let web: WebConfig | null = null
  const vpub = clean(appConfig.vapid_public)
  const vpriv = clean(appConfig.vapid_private)
  if (vpub && vpriv) web = { public_key: vpub, private_key: vpriv, subject: clean(appConfig.vapid_subject) || 'mailto:noreply@heimat.app' }
  else problems.push('web push is not set up (vapid_public, vapid_private)')

  return { apns, fcm: sa, web, problems }
}

/* ---------- device addresses ---------- */

export type Transport =
  | { kind: 'apns'; platform: 'ios'; token: string; sandbox: boolean }
  | { kind: 'fcm'; platform: 'android'; token: string }
  | { kind: 'web'; platform: 'web' }

/* 'apns-dev:' is an iPhone app built from Xcode (Apple's test server); 'apns:' is the App
   Store / TestFlight app; 'fcm:' is Android; anything else is a browser's address */
export function transportOf(endpoint: string): Transport {
  if (endpoint.startsWith('apns-dev:')) return { kind: 'apns', platform: 'ios', token: endpoint.slice(9), sandbox: true }
  if (endpoint.startsWith('apns:')) return { kind: 'apns', platform: 'ios', token: endpoint.slice(5), sandbox: false }
  if (endpoint.startsWith('fcm:')) return { kind: 'fcm', platform: 'android', token: endpoint.slice(4) }
  return { kind: 'web', platform: 'web' }
}

/* enough to tell devices apart in a log, never the whole token */
export function deviceHint(endpoint: string): string {
  const t = transportOf(endpoint)
  if (t.kind === 'web') {
    try {
      return `web@${new URL(endpoint).host}`
    } catch {
      return 'web@?'
    }
  }
  return `${t.platform}…${t.token.slice(-6)}`
}

/* which Apple server a device goes to first: a build from Xcode always to the test
   server; a store build to whichever the settings say (production unless APNS_ENV says
   otherwise) */
export function apnsHostFor(endpoint: string, cfg: Pick<ApnsConfig, 'production'>): string {
  const t = transportOf(endpoint)
  if (t.kind === 'apns' && t.sandbox) return APNS_HOST.sandbox
  return cfg.production ? APNS_HOST.production : APNS_HOST.sandbox
}

export const otherApnsHost = (host: string) => (host === APNS_HOST.production ? APNS_HOST.sandbox : APNS_HOST.production)

export type HttpAnswer = { status: number; reason?: string }

/* What to do with Apple's answer from the first server:
   - 'ok'        delivered
   - 'gone'      the app was removed or notifications were switched off (410 / Unregistered)
   - 'other-host' BadDeviceToken: usually a token for the other server (an Xcode build's
                 token sent to production, or the other way round) — try that one once
   - 'fail'      anything else; the device stays (a wrong key or app id is the server's
                 fault, not the phone's — DeviceTokenNotForTopic included) */
export function apnsFirstAnswer(a: HttpAnswer): 'ok' | 'gone' | 'other-host' | 'fail' {
  if (a.status >= 200 && a.status < 300) return 'ok'
  if (a.status === 410 || a.reason === 'Unregistered') return 'gone'
  if (a.status === 400 && a.reason === 'BadDeviceToken') return 'other-host'
  return 'fail'
}

/* ...and from the other server, after a BadDeviceToken from the first: refused by both
   means the token really is bad */
export function apnsSecondAnswer(a: HttpAnswer): 'ok' | 'gone' | 'fail' {
  if (a.status >= 200 && a.status < 300) return 'ok'
  if (a.status === 410 || a.reason === 'Unregistered') return 'gone'
  if (a.status === 400 && a.reason === 'BadDeviceToken') return 'gone'
  return 'fail'
}

/* Google's answer: the token is dead only when FCM says the app is no longer registered */
export function fcmGone(httpStatus: number, errorStatus?: string, errorCode?: string): boolean {
  return httpStatus === 404 || errorStatus === 'UNREGISTERED' || errorStatus === 'NOT_FOUND' || errorCode === 'UNREGISTERED'
}

/* a browser's push service: 404/410 mean the subscription was thrown away */
export const webGone = (httpStatus?: number) => httpStatus === 404 || httpStatus === 410

/* ---------- plain words ---------- */

/* Why it failed, for anyone pressing "Send a test notification" — so plain words only,
   never the names of server settings. Whoever looks after the server finds Apple's or
   Google's own code for it (InvalidProviderToken, SENDER_ID_MISMATCH, DataError …) in
   the function's log line (summaryLine). */
const SERVER_SIDE = 'This needs fixing on the server, not on this device.'

/* why Apple refused */
export function apnsReasonText(status: number, reason?: string): string {
  switch (reason) {
    case 'Unregistered':
    case 'ExpiredToken':
      return 'this iPhone has stopped notifications for the app. Turn them on again in the app.'
    case 'BadDeviceToken':
      return "Apple doesn't recognise this iPhone. Turn notifications off and on again in the app."
    case 'DeviceTokenNotForTopic':
    case 'BadTopic':
    case 'TopicDisallowed':
      return `the server is set up for a different iPhone app. ${SERVER_SIDE}`
    case 'InvalidProviderToken':
    case 'MissingProviderToken':
    case 'BadCertificate':
    case 'BadCertificateEnvironment':
    case 'Forbidden':
      return `Apple didn't accept the server's key for iPhone notifications. ${SERVER_SIDE}`
    case 'ExpiredProviderToken':
    case 'TooManyProviderTokenUpdates':
      return 'Apple asked the server to wait a moment. Try again in a minute.'
    case 'TooManyRequests':
      return 'too many notifications to this iPhone just now. Try again in a minute.'
    case 'InternalServerError':
    case 'ServiceUnavailable':
    case 'Shutdown':
      return "Apple's notification service is having trouble. Try again later."
  }
  if (status >= 500) return "Apple's notification service is having trouble. Try again later."
  return `Apple said no (${reason || status}).`
}

export function fcmReasonText(httpStatus: number, errorStatus?: string, errorCode?: string): string {
  if (fcmGone(httpStatus, errorStatus, errorCode)) return 'this phone has stopped notifications for the app. Turn them on again in the app.'
  if (errorCode === 'SENDER_ID_MISMATCH') return `the server is set up for a different Android app. ${SERVER_SIDE}`
  if (errorStatus === 'PERMISSION_DENIED' || errorStatus === 'UNAUTHENTICATED' || httpStatus === 401 || httpStatus === 403)
    return `Google didn't accept the server's key for Android notifications. ${SERVER_SIDE}`
  if (errorStatus === 'INVALID_ARGUMENT') return "Google doesn't recognise this phone. Turn notifications off and on again in the app."
  if (errorStatus === 'QUOTA_EXCEEDED' || httpStatus === 429) return 'too many notifications just now. Try again in a minute.'
  if (httpStatus >= 500 || errorStatus === 'UNAVAILABLE' || errorStatus === 'INTERNAL')
    return "Google's notification service is having trouble. Try again later."
  return `Google said no (${errorCode || errorStatus || httpStatus}).`
}

export function webReasonText(httpStatus?: number): string {
  if (webGone(httpStatus)) return "this browser's notification sign-up has expired. Turn notifications off and on again."
  if (httpStatus === 401 || httpStatus === 403) return "the browser's push service didn't accept the server's key. Turn notifications off and on again."
  if (httpStatus === 413) return 'the notification was too long for this browser.'
  if (httpStatus === 429) return 'too many notifications just now. Try again in a minute.'
  if (httpStatus && httpStatus >= 500) return "the browser's push service is having trouble. Try again later."
  return httpStatus ? `the browser's push service said no (${httpStatus}).` : "the browser's push service couldn't be reached."
}

export const NOT_CONFIGURED: Record<Platform, string> = {
  ios: "Notifications for iPhone aren't switched on on the server yet.",
  android: "Notifications for Android aren't switched on on the server yet.",
  web: "Notifications for browsers aren't switched on on the server yet.",
}

/* ---------- one line per request for the log ---------- */

export type DeviceResult = { platform: Platform; ok: boolean; gone?: boolean; reason?: string; hint?: string; code?: string }

export function summaryLine(
  event: string, recipients: number, results: DeviceResult[],
  configured: { apns: boolean; fcm: boolean; web: boolean }, problems: string[] = [], note?: string,
): string {
  const sent = results.filter((r) => r.ok).length
  const failures = results.filter((r) => !r.ok).map((r) => ({ device: r.hint || r.platform, code: r.code, gone: r.gone || undefined }))
  // the settings' problems only matter when a device needed what is missing
  const relevant = failures.some((f) => f.code === 'not-configured') ? problems : []
  return JSON.stringify({
    push: event, recipients, devices: results.length, sent, failed: failures.length, configured,
    ...(note ? { note } : {}), ...(failures.length ? { failures } : {}), ...(relevant.length ? { problems: relevant } : {}),
  })
}

/* something thrown while sending (no answer at all, or a key that can't be read) */
export function thrownReasonText(platform: Platform, name?: string, message?: string): string {
  const service = platform === 'ios' ? "Apple's notification service" : platform === 'android' ? "Google's notification service" : "the browser's push service"
  if (name === 'TimeoutError' || name === 'AbortError') return `${service} didn't answer in time. Try again.`
  if (name === 'DataError' || /private key|not a key|pkcs8|key data/i.test(message || '')) {
    const kind = platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'browser'
    return `the server's key for ${kind} notifications can't be read. ${SERVER_SIDE}`
  }
  return `${service} couldn't be reached. Try again.`
}
