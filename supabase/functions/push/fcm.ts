/* Firebase Cloud Messaging (HTTP v1) for the Android app. The service-account
   JSON from the Firebase console goes into app_config as `fcm_service_account`. */
import { signJwt } from './jwt.ts'
import type { SendResult } from './apns.ts'

type ServiceAccount = { project_id: string; client_email: string; private_key: string }

export const fcmConfig = (c: Record<string, string>): ServiceAccount | null => {
  if (!c.fcm_service_account) return null
  try {
    const sa = JSON.parse(c.fcm_service_account) as ServiceAccount
    return sa.project_id && sa.client_email && sa.private_key ? sa : null
  } catch {
    console.error('fcm_service_account is not valid JSON')
    return null
  }
}

let cached: { token: string; expires: number } | null = null

/* the usual two-step: sign a JWT as the service account, swap it for an access token */
const accessToken = async (sa: ServiceAccount) => {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.expires - 60 > now) return cached.token

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
  })
  if (!res.ok) throw new Error(`fcm token exchange failed: ${res.status} ${await res.text()}`)
  const json = await res.json()
  cached = { token: json.access_token, expires: now + (json.expires_in || 3600) }
  return cached.token
}

export async function sendFcm(sa: ServiceAccount, deviceToken: string, n: { title: string; body: string; tag?: string }): Promise<SendResult> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(sa)}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: n.title, body: n.body },
        android: {
          priority: 'HIGH',
          notification: {
            icon: 'ic_stat_heimat',
            color: '#3ddc97',
            ...(n.tag ? { tag: n.tag } : {}),
          },
        },
      },
    }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({} as any))
  const status = body?.error?.status as string | undefined
  // the app was uninstalled, or FCM reissued the token
  const gone = res.status === 404 || status === 'UNREGISTERED' || status === 'NOT_FOUND'
  return { ok: false, gone, status: res.status, reason: status || JSON.stringify(body).slice(0, 200) }
}
