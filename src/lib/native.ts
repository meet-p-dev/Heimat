/* Everything that only exists when Heimat runs inside its iOS/Android shell.
   Each helper is a no-op on the web, so callers never have to branch. */
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { SplashScreen } from '@capacitor/splash-screen'
import { Keyboard } from '@capacitor/keyboard'
import { Browser } from '@capacitor/browser'
import { Share } from '@capacitor/share'
import { Clipboard } from '@capacitor/clipboard'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web'
export const isNativeIOS = isNative && platform === 'ios'
export const isNativeAndroid = isNative && platform === 'android'

/* Where the app lives on the web — used for invite links, which have to be
   openable by someone who doesn't have the app yet (in the shell, location.origin
   is capacitor://localhost and useless to a flatmate). */
export const webOrigin = () => {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined
  if (isNative) return (configured || 'https://meet-p-dev.github.io/Heimat/').replace(/\/?$/, '/')
  // always ends in '/' so callers can just append a path
  return (location.origin + location.pathname).replace(/[^/]*$/, '')
}

/* status bar text colour follows the app's own light/dark switch, not the OS one */
export async function applyStatusBarTheme(dark: boolean) {
  if (!isNative) return
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {}
}

let splashHidden = false
export async function hideSplash() {
  if (!isNative || splashHidden) return
  splashHidden = true
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 })
  } catch {}
}

/* one-time setup, called before React mounts */
export async function initNative(dark: boolean) {
  if (!isNative) return
  // the app hides the splash once React paints; this is the safety net for the
  // case where it never does, so a broken build shows something rather than nothing
  setTimeout(hideSplash, 4000)
  await applyStatusBarTheme(dark)
  if (isNativeIOS) {
    // the app has its own inputs; iOS's prev/next/Done bar just eats space
    try { await Keyboard.setAccessoryBarVisible({ isVisible: false }) } catch {}
  }
}

/* Android hardware/gesture back. The handler returns true when it consumed the
   press (closed a sheet); otherwise we minimise rather than kill the app. */
export function onHardwareBack(handler: () => boolean) {
  if (!isNativeAndroid) return () => {}
  const p = CapApp.addListener('backButton', () => {
    if (!handler()) CapApp.minimizeApp()
  })
  return () => { p.then((h) => h.remove()).catch(() => {}) }
}

/* coming back from the background: realtime may have missed rows while asleep */
export function onAppResume(handler: () => void) {
  if (!isNative) return () => {}
  const p = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) handler() })
  return () => { p.then((h) => h.remove()).catch(() => {}) }
}

/* http(s) links must leave the web view, or they replace the app with a web page */
export async function openExternal(url: string) {
  if (isNative) { try { await Browser.open({ url }); return } catch {} }
  window.open(url, '_blank', 'noopener')
}

export async function shareText(text: string, title = 'Heimat'): Promise<boolean> {
  if (isNative) {
    try { await Share.share({ title, text, dialogTitle: title }); return true } catch { return false }
  }
  if (navigator.share) { try { await navigator.share({ title, text }); return true } catch { return false } }
  return false
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (isNative) { await Clipboard.write({ string: text }); return true }
    await navigator.clipboard.writeText(text)
    return true
  } catch { return false }
}
