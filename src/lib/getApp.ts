/* For the pages a link lands on (join.html, invite.html): which phone this is, a link
   that opens the installed app (and what happens when it isn't installed), and where to
   get it. Plain functions, no React — those pages are deliberately light. */

/* Where to download the apps. Empty until there is a public link: the page then offers
   only the browser, which does everything the apps do. Set these when the iPhone app has
   an App Store (or public TestFlight) link and the Android app a download. */
export const IOS_APP_URL = ''
export const ANDROID_APP_URL = ''
const ANDROID_PACKAGE = 'app.heimat.mobile'

export function device(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent
  if (/Android/.test(ua)) return 'android'
  // an iPad reports itself as a Mac with a touchscreen
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1)) return 'ios'
  return 'other'
}

/* A link into the app: heimat://<path>. On Android it goes through Chrome's intent link,
   which opens the app when it's installed and otherwise comes back to `fallback` (this
   page, marked so it doesn't try again) instead of an error. */
export function openAppHref(path: string, fallback: string): string {
  if (device() === 'android') {
    return `intent://${path}#Intent;scheme=heimat;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  }
  return `heimat://${path}`
}

export function downloadHref(): string | null {
  const d = device()
  return (d === 'ios' && IOS_APP_URL) || (d === 'android' && ANDROID_APP_URL) || null
}
