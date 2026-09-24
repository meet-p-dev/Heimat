import type { Expense, Shift, Runway } from './types'
import { deriveShift } from './shift'
import { tod } from './format'
import { settlePlan, sharesOf, toMajor } from './ledger'

/* Balances, who owes whom and the settle-up plan all come from the ledger
   (./ledger.ts), in whole cents. What is left here is the per-person
   planning maths built on top of it. */

export interface SettleSuggestion { from: string; to: string; amount: number }

/* the fewest payments that square everyone up — see settlePlan */
export function settleSuggestions(netMinor: Map<string, number>, cur?: string): SettleSuggestion[] {
  return settlePlan(netMinor, cur).map(({ from, to, amount }) => ({ from, to, amount }))
}

export interface RunwayCalc { left: number; monthsLeft: number; burn: number; spentSince: number; elapsed: number }

/* whole days between two YYYY-MM-DD dates, read as calendar dates — not as
   UTC instants, which put the same runway a month apart in Berlin and New York */
const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000
const AVG_MONTH_DAYS = 365.2425 / 12

export function computeRunway(runway: Runway | null, expenses: Expense[], uid: string | null, today = tod()): RunwayCalc | null {
  if (!runway || !runway.total) return null
  let spentMinor = 0
  for (const e of expenses) {
    if (!uid || e.spent_on < runway.start) continue
    const mine = sharesOf(e).find((x) => x.uid === uid)
    if (mine) spentMinor += mine.minor
  }
  const spentSince = toMajor(spentMinor)
  const left = Math.max(runway.total - spentSince, 0)
  const days = Math.max(dayNo(today) - dayNo(runway.start), 0)
  const monthsElapsed = Math.max(days / AVG_MONTH_DAYS, 0.1)
  const burn = Math.max(spentSince / monthsElapsed, runway.monthly || 0, 1)
  return { left, monthsLeft: left / burn, burn, spentSince, elapsed: monthsElapsed }
}

export interface WorkLimits { weekCap: number; yearDays: number }
export interface EmployerStat { name: string; pay: number; hours: number; count: number; wage: number }
export interface WorkStats {
  daysUsed: number; budget: number; weekCap: number; weekH: number; count: number
  earnMonth: number; earnYear: number; earnAll: number; avgRate: number
  byEmployer: EmployerStat[]; tone: 'red' | 'amber' | 'green'
}

/* limits default to Germany's: ~120 full days a year, 20 h a week in term */
export function computeWorkStats(shifts: Shift[], limits: WorkLimits = { weekCap: 20, yearDays: 120 }): WorkStats {
  const yr = tod().slice(0, 4)
  const mo = tod().slice(0, 7)
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day)
  const mk = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  let full = 0, half = 0, earnMonth = 0, earnYear = 0, earnAll = 0, yearPaidH = 0, weekH = 0, count = 0
  const byEmp: Record<string, { pay: number; hours: number; count: number }> = {}
  shifts.forEach((s) => {
    const d = deriveShift(s)
    earnAll += d.pay
    if (s.date.slice(0, 4) === yr) {
      earnYear += d.pay
      if (d.wage > 0) yearPaidH += d.paidHours
      count++
      if (d.legalHours > 0) d.legalHours >= 4 ? full++ : half++
    }
    if (s.date.slice(0, 7) === mo) {
      earnMonth += d.pay
      const k = s.employer || 'Unassigned'
      if (!byEmp[k]) byEmp[k] = { pay: 0, hours: 0, count: 0 }
      byEmp[k].pay += d.pay
      byEmp[k].hours += d.paidHours
      byEmp[k].count++
    }
    if (s.date >= mk) weekH += d.legalHours
  })
  const daysUsed = full + half * 0.5
  const byEmployer: EmployerStat[] = Object.keys(byEmp)
    .map((name) => ({ name, ...byEmp[name], wage: byEmp[name].hours > 0 ? byEmp[name].pay / byEmp[name].hours : 0 }))
    .sort((a, b) => b.pay - a.pay)
  const budget = Math.max(limits.yearDays, 1), weekCap = Math.max(limits.weekCap, 1)
  const dayPct = daysUsed / budget, weekPct = weekH / weekCap
  const tone: 'red' | 'amber' | 'green' = dayPct >= 1 || weekPct >= 1 ? 'red' : dayPct >= 0.8 || weekPct >= 0.8 ? 'amber' : 'green'
  return { daysUsed, budget, weekCap, weekH, count, earnMonth, earnYear, earnAll, avgRate: yearPaidH > 0 ? earnYear / yearPaidH : 0, byEmployer, tone }
}
