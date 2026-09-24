import { isNative } from './native'

/* switched from Settings → Haptic feedback */
let enabled = true
export const setHapticsEnabled = (on: boolean) => { enabled = on }

/* Web: the Vibration API (Android browsers only — iOS Safari has none).
   Native: the real Taptic/haptic engine, so iOS finally gets feedback too. */
export const haptic = (ms = 10) => {
  if (!enabled) return
  try {
    if (isNative) {
      import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => {
        Haptics.impact({ style: ms <= 9 ? ImpactStyle.Light : ms <= 13 ? ImpactStyle.Medium : ImpactStyle.Heavy }).catch(() => {})
      }).catch(() => {})
      return
    }
    if (navigator.vibrate) navigator.vibrate(ms)
  } catch {}
}
