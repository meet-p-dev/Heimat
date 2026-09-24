import { LS } from './storage'

export type ThemeMode = 'system' | 'light' | 'dark'

/* Device-level settings. Like the rest of the personal half of Heimat, they
   never leave the phone. */
export interface Prefs {
  theme: ThemeMode
  reduceGlass: boolean // solid surfaces instead of translucent glass
  haptics: boolean
  autoRate: boolean // refresh the exchange rate once a day
  weekCap: number // hours a week you may work during term
  yearDays: number // full working days a year
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', reduceGlass: false, haptics: true, autoRate: true, weekCap: 20, yearDays: 120 }

const KEY = 'mt-h-prefs'

export function loadPrefs(): Prefs {
  const saved = LS.g<Partial<Prefs>>(KEY)
  if (saved) return { ...DEFAULT_PREFS, ...saved }
  // before there were settings there was only a dark-mode switch — keep its answer
  const legacyDark = LS.g<boolean>('mt-h-dark')
  return legacyDark == null ? DEFAULT_PREFS : { ...DEFAULT_PREFS, theme: legacyDark ? 'dark' : 'light' }
}

export const savePrefs = (p: Prefs) => LS.s(KEY, p)

export const systemDark = () =>
  typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches

export const resolveDark = (p: Prefs) => (p.theme === 'system' ? systemDark() : p.theme === 'dark')

/* index.css keys every colour and the glass on these two attributes */
export function applyThemeToDocument(dark: boolean, reduceGlass: boolean) {
  const r = document.documentElement
  r.dataset.theme = dark ? 'dark' : 'light'
  r.dataset.glass = reduceGlass ? 'off' : 'on'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#070b0a' : '#eef2f0')
}
