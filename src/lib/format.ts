import { parseMinor, toMajor } from './ledger'

export const tod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* Each currency with its own number of decimals (2 for EUR, 0 for JPY), rounded
   half away from zero — the rule the iOS app's Fmt.money uses too, so the two
   print the same digits for the same number. */
export const money = (v: number, code: string) => {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: code }).format(v || 0)
  } catch {
    return (v || 0).toFixed(2).replace('.', ',') + ' ' + code
  }
}

/* A plain number someone typed — a rate, hours, a wage. "12,5", "12.5",
   "1.234,56" and "1,234.56" all read as they look; with one lone separator it
   is the decimal point. For money amounts use amountVal, which knows the
   currency's decimals. Unreadable input is 0, as before. */
export const numVal = (s: string) => {
  let t = String(s || '').replace(/[\s\u00a0\u202f'\u2019]/g, '').replace('\u2212', '-')
  const dot = t.lastIndexOf('.'), comma = t.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) t = dot > comma ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.')
  else if ((t.match(/[.,]/g) || []).length > 1) t = t.replace(/[.,]/g, '')
  else t = t.replace(',', '.')
  const v = Number(t)
  return Number.isFinite(v) ? v : 0
}

/* a money amount someone typed, in major units — 0 if it is not a valid
   amount in `cur` (see parseMinor: "1.200" is twelve hundred euros) */
export const amountVal = (s: string, cur?: string) => {
  const m = parseMinor(s, cur)
  return m == null ? 0 : toMajor(m, cur)
}

export const fixDe = (v: number, d = 1) => (v || 0).toFixed(d).replace('.', ',')

/* an exchange rate to four significant digits: 104,52 · 1,080 · 0,09563 */
export const rateDe = (r: number) => fixDe(r, r > 0 ? Math.max(2, 3 - Math.floor(Math.log10(r))) : 2)

const day = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00')

/* "Today", "Yesterday", "Tuesday", "3 Sep", "3 Sep 2025" — a raw 2026-09-03 makes people do arithmetic */
export const relDay = (iso: string) => {
  if (!iso) return ''
  const d = day(iso)
  if (isNaN(d.getTime())) return iso
  const diff = Math.round((day(tod()).getTime() - d.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  const thisYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, thisYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

export const monthLabel = (iso: string) => day(iso.slice(0, 7) + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export const longToday = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

export const greeting = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
