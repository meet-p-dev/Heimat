import { sb } from './supabase'
import { isNative, platform } from './native'
import { testResultMessage } from './pushResult'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/* The Android app can only use push once the Firebase project's google-services.json
   is in android/app (vite.config.ts checks at build time). Without it the plugin's
   register() crashes the whole app, so every path that could reach it checks this. */
export const pushMissingInBuild = platform === 'android' && !(typeof __ANDROID_PUSH__ !== 'undefined' && __ANDROID_PUSH__)

/* iOS only exposes the Push API to a PWA installed on the Home Screen */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/* push is usable at all: SW + Push API + a configured VAPID key.
   In the native shells the OS handles delivery, so neither is needed. */
export const pushSupported = () =>
  !pushMissingInBuild && (isNative || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC))

/* on iOS in a plain Safari tab the API simply isn't there — the user must install the app first */
export const needsInstall = () => !isNative && isIOS() && !isStandalone() && !pushSupported()

export type Perm = NotificationPermission | 'unsupported'

/* async because the native permission lives behind a bridge call */
export async function permission(): Promise<Perm> {
  if (pushMissingInBuild) return 'unsupported'
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

/* getRegistration rather than `ready`: `ready` never settles when no worker was
   ever registered, and signing out waits on this */
export async function getSubscription() {
  if (isNative || !pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
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
/* switched off on this device, by the person themselves, in Settings */
export const pushSwitchedOff = () => !wantsPush()

/* Is this device currently set up to receive notifications? On the web that's a
   live subscription; in the apps, permission granted and not switched off since. */
export async function isSubscribed(): Promise<boolean> {
  if (isNative) return wantsPush() && (await permission()) === 'granted'
  return !!(await getSubscription())
}

/* Every device is saved through save_push_device (supabase/migrations/20261005000000_push_fixes.sql).
   `endpoint` is the web-push URL on the web and a prefixed device token in the apps,
   and a device already saved for another account — a guest session, someone who
   signed out — moves to whoever is signed in now. */
const saveDevice = async (endpoint: string, p256dh: string | null = null, auth: string | null = null) => {
  if (!sb) return 'offline'
  const { error } = await sb.rpc('save_push_device', { p_endpoint: endpoint, p_platform: platform, p_p256dh: p256dh, p_auth: auth })
  return error ? error.message : null
}
/* only ever removes the device from the account signed in now */
const forgetDevice = async (endpoint: string) => {
  if (!sb) return
  await sb.rpc('forget_push_device', { p_endpoint: endpoint })
}

/* ---- native (APNs on iOS, FCM on Android) ---- */

const nativeEndpoint = (token: string) => (platform === 'ios' ? 'apns:' : 'fcm:') + token
// the token this launch got, so signing out needn't ask the OS for it again
let lastToken: string | null = null

/* Android 8+ shows a notification only through a channel. The server names this
   one (android.notification.channel_id) and the manifest makes it the default.
   Android keeps a channel's first settings for good, so they have to be right here:
   it buzzes (the plugin turns vibration off unless asked), and on the lock screen it
   follows the phone's own "hide sensitive content" choice (private, not public:
   these carry amounts of money). */
async function ensureChannel() {
  if (platform !== 'android') return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  try {
    await PushNotifications.createChannel({ id: 'splitlife', name: 'Splitlife', description: 'Expenses, payments and reminders', importance: 4, visibility: 0, vibration: true })
  } catch {}
}

const nativeToken = (wait = 12000) =>
  new Promise<{ token?: string; error?: string }>(async (resolve) => {
    if (pushMissingInBuild) return resolve({ error: 'android-unavailable' })
    let settled = false
    const done = (r: { token?: string; error?: string }) => {
      if (settled) return
      settled = true
      if (r.token) lastToken = r.token
      resolve(r)
    }
    // the OS can stay silent (no network, no APNs entitlement) — don't hang the UI on it
    setTimeout(() => done({ error: 'timeout' }), wait)
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      const reg = await PushNotifications.addListener('registration', (t) => done({ token: t.value }))
      const err = await PushNotifications.addListener('registrationError', (e) =>
        done({ error: (e as any)?.error || 'registration failed' })
      )
      setTimeout(() => { reg.remove(); err.remove() }, wait + 1000)
      await ensureChannel()
      await PushNotifications.register()
    } catch (e: any) {
      done({ error: e?.message || 'registration failed' })
    }
  })

async function subscribeNative(): Promise<{ ok: boolean; reason?: string }> {
  if (pushMissingInBuild) return { ok: false, reason: 'android-unavailable' }
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') return { ok: false, reason: 'denied' }

  const { token, error } = await nativeToken()
  if (!token) return { ok: false, reason: error || 'notoken' }

  const msg = await saveDevice(nativeEndpoint(token))
  if (msg) return { ok: false, reason: msg }
  setWantsPush(true)
  return { ok: true }
}

/* Foreground taps and deliveries. Registered once at startup so a notification
   tapped from the tray brings the user to fresh data. The token itself is saved by
   resaveIfSubscribed, once there's a signed-in account to save it for. */
export async function initNativeListeners(onOpened: () => void) {
  if (!isNative || pushMissingInBuild) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await PushNotifications.addListener('pushNotificationActionPerformed', () => onOpened())
  await PushNotifications.addListener('pushNotificationReceived', () => onOpened())
}

/* ---- web push ---- */

const subKeys = (sub: PushSubscription) => {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  const p256dh = json.keys?.p256dh || keyToB64(sub.getKey('p256dh'))
  const auth = json.keys?.auth || keyToB64(sub.getKey('auth'))
  return p256dh && auth ? { p256dh, auth } : null
}

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

  const keys = subKeys(sub)
  if (!keys) return { ok: false, reason: 'nokeys' }

  const msg = await saveDevice(sub.endpoint, keys.p256dh, keys.auth)
  if (msg) return { ok: false, reason: msg }
  setWantsPush(true)
  return { ok: true }
}

/* ask for permission, subscribe, and store the subscription so the server can reach this device */
export async function subscribe(): Promise<{ ok: boolean; reason?: string }> {
  if (!sb) return { ok: false, reason: 'offline' }
  // never throws: the buttons that call this stay busy until it answers, and a browser
  // whose push service is off (Brave by default) rejects pushManager.subscribe
  try {
    return await (isNative ? subscribeNative() : subscribeWeb())
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'error' }
  }
}

/* what to say when subscribe() didn't work */
export const subscribeError = (reason?: string) =>
  reason === 'denied' ? (isNative ? 'Blocked — allow Splitlife in Settings → Notifications' : 'Blocked — allow notifications in your browser settings')
  : reason === 'install' ? 'Add Splitlife to your Home Screen first'
  : reason === 'android-unavailable' ? "Notifications aren't available in this test version yet."
  : "Couldn't turn on notifications"

export async function unsubscribe(): Promise<boolean> {
  setWantsPush(false)
  if (isNative) {
    // the OS permission stays granted — dropping the row is what actually stops
    // the server reaching this device. Listeners stay put so a re-enable works.
    if (pushMissingInBuild) return true
    const token = lastToken || (await nativeToken()).token
    if (token) await forgetDevice(nativeEndpoint(token))
    return true
  }
  try {
    const sub = await getSubscription()
    if (!sub) return true
    await forgetDevice(sub.endpoint)
    await sub.unsubscribe()
  } catch {}
  return true
}

/* Save this device again for whoever is signed in now. App.tsx calls it whenever the
   signed-in account changes, which includes every launch: that moves the device away
   from an earlier account and picks up a rotated APNs/FCM token. Does nothing unless
   notifications are already on here. */
export async function resaveIfSubscribed(): Promise<void> {
  if (!sb || !pushSupported()) return
  try {
    if (isNative) {
      if (!wantsPush() || (await permission()) !== 'granted') return
      const { token } = await nativeToken()
      // switched off in Settings while the token was on its way: unsubscribe() has
      // already forgotten this device, and saving now would bring it back
      if (token && wantsPush()) await saveDevice(nativeEndpoint(token))
      return
    }
    const sub = await getSubscription()
    const keys = sub && subKeys(sub)
    if (sub && keys && wantsPush()) await saveDevice(sub.endpoint, keys.p256dh, keys.auth)
  } catch {}
}

/* Called just before signing out, so the account that's leaving stops reaching this
   device. The OS permission and the browser subscription stay: whoever signs in next
   gets the device back through resaveIfSubscribed. Never holds sign-out up for long. */
export async function forgetThisDevice(): Promise<void> {
  if (!sb || !pushSupported()) return
  const work = (async () => {
    let endpoint: string | null = null
    if (!isNative) endpoint = (await getSubscription())?.endpoint || null
    else if (wantsPush()) {
      const token = lastToken || ((await permission()) === 'granted' ? (await nativeToken(4000)).token : null)
      endpoint = token ? nativeEndpoint(token) : null
    }
    if (endpoint) await forgetDevice(endpoint)
  })().catch(() => {})
  await Promise.race([work, new Promise((r) => setTimeout(r, 5000))])
}

/* Settings → "Send a test notification": the server sends one to each of your devices
   and says how each went; pushResult.ts puts that in words for this kind of device.
   This device is saved for the account signed in now first (as the iPhone app does),
   so a save that failed at launch doesn't read as "isn't registered" with the switch on. */
export async function sendTestNotification(): Promise<string> {
  if (!sb) return "You're offline. Try again when you're connected."
  try {
    await resaveIfSubscribed()
    const { data, error } = await sb.functions.invoke('push', { body: { event: 'test' } })
    if (error) return "Couldn't send a test right now. Try again in a moment."
    return testResultMessage(platform, typeof data === 'string' ? JSON.parse(data) : data)
  } catch {
    return "Couldn't send a test right now. Try again in a moment."
  }
}
