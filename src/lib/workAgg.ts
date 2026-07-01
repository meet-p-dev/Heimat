import type { Shift } from './types'
import { deriveShift } from './shift'

export const MO3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WD3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WD1 = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export type Gran = 'day' | 'week' | 'month' | 'year'

/* ISO-8601 week number → [year, week] */
export function isoWeek(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (dt.getUTCDay() + 6) % 7 // Mon = 0
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3) // Thursday of this week
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
  return [dt.getUTCFullYear(), week]
}

export interface BucketRow { key: string; header: string; label: string; sub: number; hours: number; pay: number }

/* group shifts into most-recent-first buckets by granularity */
export function groupShifts(shifts: Shift[], gran: Gran): BucketRow[] {
  const map = new Map<string, { header: string; label: string; hours: number; pay: number; days: Set<string>; count: number; sort: string }>()
  for (const s of shifts) {
    if (!s.date) continue
    const der = deriveShift(s)
    const [Y, M, D] = s.date.split('-')
    let key = '', header = '', label = '', sort = ''
    if (gran === 'day') {
      key = s.date; header = `${MO3[+M - 1]} ${Y}`
      const wd = WD3[(new Date(s.date + 'T00:00:00').getDay() + 6) % 7]
      label = `${+D} ${wd}`; sort = s.date
    } else if (gran === 'week') {
      const [wy, wn] = isoWeek(s.date)
      key = `${wy}-W${String(wn).padStart(2, '0')}`; header = `${wy}`; label = `Week ${wn}`; sort = key
    } else if (gran === 'month') {
      key = `${Y}-${M}`; header = `${Y}`; label = MO3[+M - 1]; sort = key
    } else {
      key = Y; header = ''; label = Y; sort = Y
    }
    let b = map.get(key)
    if (!b) { b = { header, label, hours: 0, pay: 0, days: new Set(), count: 0, sort }; map.set(key, b) }
    b.hours += der.paidHours; b.pay += der.pay; b.days.add(s.date); b.count++
  }
  const rows = [...map.entries()].map(([key, b]) => ({ key, header: b.header, label: b.label, sub: gran === 'day' ? b.count : b.days.size, hours: b.hours, pay: b.pay, sort: b.sort }))
  rows.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0))
  return rows.map(({ sort, ...r }) => r)
}

export interface DayInfo { hours: number; pay: number; count: number }

export function workedMap(shifts: Shift[]): Map<string, DayInfo> {
  const m = new Map<string, DayInfo>()
  for (const s of shifts) {
    if (!s.date) continue
    const der = deriveShift(s)
    const cur = m.get(s.date) || { hours: 0, pay: 0, count: 0 }
    cur.hours += der.paidHours; cur.pay += der.pay; cur.count++
    m.set(s.date, cur)
  }
  return m
}

/* Monday-first grid of date strings (null = padding) for a given year/month (0-based month) */
export function monthMatrix(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1)
  const startPad = (first.getDay() + 6) % 7
  const daysIn = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
