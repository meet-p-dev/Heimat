import { sb } from './supabase'
import { isNative, platform } from './native'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/* iOS only exposes the Push API to a PWA installed on the Home Screen */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/* push is usable at all: SW + Push API + a configured VAPID key.
   In the native shells the OS handles delivery, so neither is needed. */
export const pushSupported = () =>
  isNative || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC)

/* on iOS in a plain Safari tab the API simply isn't there — the user must install the app first */
export const needsInstall = () => !isNative && isIOS() && !isStandalone() && !pushSupported()

export type Perm = NotificationPermission | 'unsupported'

/* async because the native permission lives behind a bridge call */
export async function permission(): Promise<Perm> {
  if (isNative) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const { receive } = await PushNotifications.checkPermissions()
    if (receive === 'granted') return 'granted'
    if (receive === 'denied') return 'denied'
    return 'default'
  }
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

function urlB64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

const keyToB64 = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : ''

export async function getSubscription() {
  if (isNative || !pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/* Turning notifications off in the apps can't revoke the OS permission, so the
   app remembers the user's own answer and stops registering the device token. */
const WANT_KEY = 'mt-h-push-on'
const wantsPush = () => {
  try { return localStorage.getItem(WANT_KEY) !== 'false' } catch { return true }
}
const setWantsPush = (on: boolean) => {
  try { localStorage.setItem(WANT_KEY, String(on)) } catch {}
}

/* Is this device currently set up to receive notifications? On the web that's a
   live subscription; in the apps, permission granted and not switched off since. */
export async function isSubscribed(): Promise<boolean> {
  if (isNative) return wantsPush() && (await permission()) === 'granted'
  return !!(await getSubscription())
}

/* The one row shape both transports share: `endpoint` is the web-push URL on the
   web and a prefixed device token on native, so it stays the natural unique key. */
const saveRow = async (row: { endpoint: string; platform: string; p256dh: string | null; auth: string | null }) => {
  if (!sb) return 'offline'
  const { error } = await sb.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' })
  return error ? error.message : null
}

/* ---- native (APNs on iOS, FCM on Android) ---- */

const nativeToken = () =>
  new Promise<{ token?: string; error?: string }>(async (resolve) => {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let settled = false
    const done = (r: { token?: string; error?: string }) => { if (!settled) { settled = true; resolve(r) } }

    const reg = await PushNotifications.addListener('registration', (t) => done({ token: t.value }))
    const err = await PushNotifications.addListener('registrationError', (e) =>
      done({ error: (e as any)?.error || 'registration failed' })
    )
    // the OS can stay silent (no network, no APNs entitlement) — don't hang the UI on it
    setTimeout(() => done({ error: 'timeout' }), 12000)

    await PushNotifications.register()

    const cleanup = () => { reg.remove(); err.remove() }
    setTimeout(cleanup, 13000)
  })

async function subscribeNative(): Promise<{ ok: boolean; reason?: string }> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return { ok: false, reason: 'denied' }

  const { token, error } = await nativeToken()
  if (!token) return { ok: false, reason: error || 'notoken' }

  const prefix = platform === 'ios' ? 'apns:' : 'fcm:'
  const msg = await saveRow({ endpoint: prefix + token, platform, p256dh: null, auth: null })
  if (msg) return { ok: false, reason: msg }
  setWantsPush(true)
  return { ok: true }
}

/* Foreground taps and deliveries. Registered once at startup so a notification
   tapped from the tray brings the user to fresh data. */
export async function initNativeListeners(onOpened: () => void) {
  if (!isNative) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await PushNotifications.addListener('pushNotificationActionPerformed', () => onOpened())
  await PushNotifications.addListener('pushNotificationReceived', () => onOpened())
  // re-register on every launch: APNs/FCM tokens rotate
  const { receive } = await PushNotifications.checkPermissions()
  if (receive === 'granted' && wantsPush()) {
    const { token } = await nativeToken()
    if (token) await saveRow({ endpoint: (platform === 'ios' ? 'apns:' : 'fcm:') + token, platform, p256dh: null, auth: null })
  }
}

/* ---- web push ---- */

async function subscribeWeb(): Promise<{ ok: boolean; reason?: string }> {
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

  const msg = await saveRow({ endpoint: sub.endpoint, platform: 'web', p256dh, auth })
  return msg ? { ok: false, reason: msg } : { ok: true }
}

/* ask for permission, subscribe, and store the subscription so the server can reach this device */
export async function subscribe(): Promise<{ ok: boolean; reason?: string }> {
  if (!sb) return { ok: false, reason: 'offline' }
  return isNative ? subscribeNative() : subscribeWeb()
}

export async function unsubscribe(): Promise<boolean> {
  if (isNative) {
    // the OS permission stays granted — dropping the row is what actually stops
    // the server reaching this device. Listeners stay put so a re-enable works.
    setWantsPush(false)
    const { token } = await nativeToken()
    if (token && sb) await sb.from('push_subscriptions').delete().eq('endpoint', (platform === 'ios' ? 'apns:' : 'fcm:') + token)
    return true
  }
  const sub = await getSubscription()
  if (!sub) return true
  if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
  return true
}
