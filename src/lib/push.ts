import { sb } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/* iOS only exposes the Push API to a PWA installed on the Home Screen */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/* push is usable at all: SW + Push API + a configured VAPID key */
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC

/* on iOS in a plain Safari tab the API simply isn't there — the user must install the app first */
export const needsInstall = () => isIOS() && !isStandalone() && !pushSupported()

export const permission = (): NotificationPermission | 'unsupported' =>
  'Notification' in window ? Notification.permission : 'unsupported'

function urlB64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const keyToB64 = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : ''

export async function getSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/* ask for permission, subscribe, and store the subscription so the server can reach this device */
export async function subscribe(): Promise<{ ok: boolean; reason?: string }> {
  if (!sb) return { ok: false, reason: 'offline' }
  if (!pushSupported()) return { ok: false, reason: needsInstall() ? 'install' : 'unsupported' }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'denied' }

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC!),
    }))

  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  const p256dh = json.keys?.p256dh || keyToB64(sub.getKey('p256dh'))
  const auth = json.keys?.auth || keyToB64(sub.getKey('auth'))
  if (!p256dh || !auth) return { ok: false, reason: 'nokeys' }

  const { error } = await sb.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh, auth },
    { onConflict: 'endpoint' }
  )
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

export async function unsubscribe(): Promise<boolean> {
  const sub = await getSubscription()
  if (!sub) return true
  if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
  return true
}
