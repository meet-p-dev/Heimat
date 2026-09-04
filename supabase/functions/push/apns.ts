/* Direct APNs delivery for the iOS app — no Firebase in the loop, so the app
   ships without the Firebase SDK and only needs its own APNs auth key. */
import { signJwt } from './jwt.ts'

export type ApnsConfig = {
  key_id: string
  team_id: string
  private_key: string // contents of the .p8 file, PEM
  topic: string       // the bundle id, app.heimat.mobile
  production: boolean
}

export const apnsConfig = (c: Record<string, string>): ApnsConfig | null => {
  if (!c.apns_key_id || !c.apns_team_id || !c.apns_private_key || !c.apns_topic) return null
  return {
    key_id: c.apns_key_id,
    team_id: c.apns_team_id,
    private_key: c.apns_private_key,
    topic: c.apns_topic,
    production: (c.apns_env || 'production') === 'production',
  }
}

// Apple allows a provider token to be reused for up to an hour; minting one per
// notification gets you throttled with 429 TooManyProviderTokenUpdates.
let cached: { token: string; at: number } | null = null

const providerToken = async (cfg: ApnsConfig) => {
  const now = Math.floor(Date.now() / 1000)
  if (cached && now - cached.at < 45 * 60) return cached.token
  const token = await signJwt('ES256', cfg.private_key, { kid: cfg.key_id }, { iss: cfg.team_id, iat: now })
  cached = { token, at: now }
  return token
}

export type SendResult = { ok: boolean; gone?: boolean; status?: number; reason?: string }

export async function sendApns(cfg: ApnsConfig, deviceToken: string, n: { title: string; body: string; tag?: string }): Promise<SendResult> {
  const host = cfg.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com'
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
    body: JSON.stringify({
      aps: { alert: { title: n.title, body: n.body }, sound: 'default', badge: 1 },
    }),
  })
  if (res.ok) return { ok: true }
  const reason = (await res.json().catch(() => ({}))).reason as string | undefined
  // the device uninstalled the app or the token was reissued
  const gone = res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered'
  return { ok: false, gone, status: res.status, reason }
}
