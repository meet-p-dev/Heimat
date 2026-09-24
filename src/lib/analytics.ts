import type { Expense, Member } from './types'
import { MO3 } from './workAgg'
import { myShareMinor, toMinor, toMajor } from './ledger'

/* Totals are summed in whole cents, then turned back into euros once, so a
   month of 0,10 € coffees adds up to what it says. */
const cents = (e: Expense) => toMinor(e.amount, e.currency) || 0

/* "2026-07" → a month number, so month arithmetic cannot overflow the way
   Date.setMonth does on the 31st (31 July − 5 months → "31 February" → 3 March) */
export const monthNo = (iso: string) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1)
export const ymOf = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`

export type Range = 'month' | '6m' | 'year'

/* range filter relative to today (YYYY-MM-DD) */
export function inRange(e: Expense, range: Range, today: string): boolean {
  if (range === 'month') return e.spent_on.slice(0, 7) === today.slice(0, 7)
  if (range === 'year') return e.spent_on.slice(0, 4) === today.slice(0, 4)
  return monthNo(e.spent_on) >= monthNo(today) - 5
}

export interface MonthPoint { ym: string; label: string; total: number }

/* trailing `months` calendar months ending at today, each with summed total */
export function monthlyTotals(expenses: Expense[], months: number, today: string): MonthPoint[] {
  const now = monthNo(today)
  const out: MonthPoint[] = []
  const minor: number[] = []
  for (let i = months - 1; i >= 0; i--) {
    const n = now - i
    out.push({ ym: ymOf(n), label: MO3[n % 12], total: 0 })
    minor.push(0)
  }
  const idx = new Map(out.map((p, i) => [p.ym, i]))
  expenses.forEach((e) => {
    const i = idx.get(e.spent_on.slice(0, 7))
    if (i != null) minor[i] += cents(e)
  })
  out.forEach((p, i) => (p.total = toMajor(minor[i])))
  return out
}

export interface CatSlice { cat: string; total: number; pct: number }
export function byCategory(expenses: Expense[]): CatSlice[] {
  const m: Record<string, number> = {}
  let tot = 0
  expenses.forEach((e) => { const c = cents(e); m[e.category] = (m[e.category] || 0) + c; tot += c })
  return Object.keys(m)
    .map((cat) => ({ cat, total: toMajor(m[cat]), pct: tot > 0 ? (m[cat] / tot) * 100 : 0 }))
    .sort((a, b) => b.total - a.total || (a.cat < b.cat ? -1 : 1))
}

export function byMember(expenses: Expense[], members: Member[]): { uid: string; total: number }[] {
  const m: Record<string, number> = {}
  members.forEach((x) => (m[x.user_id] = 0))
  expenses.forEach((e) => { if (m[e.paid_by] != null) m[e.paid_by] += cents(e) })
  return members.map((x) => ({ uid: x.user_id, total: toMajor(m[x.user_id] || 0) })).sort((a, b) => b.total - a.total)
}

/* your personal share = the sum of your slice of each expense you're split into,
   as the ledger allocates it (so 10 € between three is 3,34 for one of you) */
export function myShareTotal(expenses: Expense[], uid: string | null): number {
  return toMajor(myShareMinor(expenses, uid))
}

export function total(expenses: Expense[]): number {
  let t = 0
  for (const e of expenses) t += cents(e)
  return toMajor(t)
}
