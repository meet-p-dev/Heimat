import type { Expense, Member } from './types'
import { MO3 } from './workAgg'

export type Range = 'month' | '6m' | 'year'

/* range filter relative to today (YYYY-MM-DD) */
export function inRange(e: Expense, range: Range, today: string): boolean {
  if (range === 'month') return e.spent_on.slice(0, 7) === today.slice(0, 7)
  if (range === 'year') return e.spent_on.slice(0, 4) === today.slice(0, 4)
  const d = new Date(today + 'T00:00:00')
  d.setMonth(d.getMonth() - 5)
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  return e.spent_on >= start
}

export interface MonthPoint { ym: string; label: string; total: number }

/* trailing `months` calendar months ending at today, each with summed total */
export function monthlyTotals(expenses: Expense[], months: number, today: string): MonthPoint[] {
  const anchor = new Date(today + 'T00:00:00')
  anchor.setDate(1)
  const out: MonthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const dd = new Date(anchor)
    dd.setMonth(anchor.getMonth() - i)
    out.push({ ym: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`, label: MO3[dd.getMonth()], total: 0 })
  }
  const idx = new Map(out.map((p, i) => [p.ym, i]))
  expenses.forEach((e) => {
    const i = idx.get(e.spent_on.slice(0, 7))
    if (i != null) out[i].total += e.amount
  })
  return out
}

export interface CatSlice { cat: string; total: number; pct: number }
export function byCategory(expenses: Expense[]): CatSlice[] {
  const m: Record<string, number> = {}
  let tot = 0
  expenses.forEach((e) => { m[e.category] = (m[e.category] || 0) + e.amount; tot += e.amount })
  return Object.keys(m)
    .map((cat) => ({ cat, total: m[cat], pct: tot > 0 ? (m[cat] / tot) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
}

export function byMember(expenses: Expense[], members: Member[]): { uid: string; total: number }[] {
  const m: Record<string, number> = {}
  members.forEach((x) => (m[x.user_id] = 0))
  expenses.forEach((e) => { if (m[e.paid_by] != null) m[e.paid_by] += e.amount })
  return members.map((x) => ({ uid: x.user_id, total: m[x.user_id] || 0 })).sort((a, b) => b.total - a.total)
}

/* your personal share = sum of your slice of each expense you're split into */
export function myShareTotal(expenses: Expense[], uid: string | null): number {
  if (!uid) return 0
  return expenses.reduce((s, e) => {
    const parts = e.split_among && e.split_among.length ? e.split_among : [e.paid_by]
    return s + (parts.includes(uid) ? e.amount / parts.length : 0)
  }, 0)
}

export function total(expenses: Expense[]): number {
  return expenses.reduce((s, e) => s + e.amount, 0)
}
