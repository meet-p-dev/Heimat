export const tod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const money = (v: number, code: string) => {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(v || 0)
  } catch {
    return (v || 0).toFixed(2).replace('.', ',') + ' ' + code
  }
}

export const numVal = (s: string) => parseFloat(String(s || '').trim().replace(',', '.')) || 0

export const fixDe = (v: number, d = 1) => (v || 0).toFixed(d).replace('.', ',')

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
