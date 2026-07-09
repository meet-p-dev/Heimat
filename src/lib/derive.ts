import type { Member, Expense, Settlement, Shift, Runway } from './types'
import { deriveShift } from './shift'
import { tod } from './format'

export function computeBalances(members: Member[], expenses: Expense[], settles: Settlement[]): Record<string, number> {
  const net: Record<string, number> = {}
  members.forEach((m) => (net[m.user_id] = 0))
  expenses.forEach((e) => {
    if (net[e.paid_by] == null) return
    net[e.paid_by] += e.amount
    const parts = e.split_among && e.split_among.length ? e.split_among : [e.paid_by]
    const share = e.amount / parts.length
    parts.forEach((u) => { if (net[u] != null) net[u] -= share })
  })
  settles.forEach((s) => {
    if (net[s.from_user] != null) net[s.from_user] += s.amount
    if (net[s.to_user] != null) net[s.to_user] -= s.amount
  })
  return net
}

export interface SettleSuggestion { from: string; to: string; amount: number }

/* greedy debt simplification: largest debtor pays largest creditor until everyone is within ±0.50 */
export function settleSuggestions(balances: Record<string, number>): SettleSuggestion[] {
  const debtors = Object.keys(balances).filter((u) => balances[u] < -0.5).map((u) => ({ u, v: -balances[u] })).sort((a, b) => b.v - a.v)
  const creditors = Object.keys(balances).filter((u) => balances[u] > 0.5).map((u) => ({ u, v: balances[u] })).sort((a, b) => b.v - a.v)
  const out: SettleSuggestion[] = []
  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v)
    if (pay > 0.5) out.push({ from: debtors[i].u, to: creditors[j].u, amount: pay })
    debtors[i].v -= pay
    creditors[j].v -= pay
    if (debtors[i].v <= 0.5) i++
    if (creditors[j].v <= 0.5) j++
  }
  return out
}

export interface RunwayCalc { left: number; monthsLeft: number; burn: number; spentSince: number }

export function computeRunway(runway: Runway | null, expenses: Expense[], uid: string | null): RunwayCalc | null {
  if (!runway || !runway.total) return null
  const spentSince = expenses
    .filter((e) => e.spent_on >= runway.start)
    .reduce((s, e) => {
      const parts = e.split_among && e.split_among.length ? e.split_among : [e.paid_by]
      return s + (uid && parts.includes(uid) ? e.amount / parts.length : 0)
    }, 0)
  const left = Math.max(runway.total - spentSince, 0)
  const start = new Date(runway.start)
  const now = new Date()
  const monthsElapsed = Math.max((now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + now.getDate() / 30, 0.1)
  const burn = Math.max(spentSince / monthsElapsed, runway.monthly || 0, 1)
  return { left, monthsLeft: left / burn, burn, spentSince }
}

export interface EmployerStat { name: string; pay: number; hours: number; count: number; wage: number }
export interface WorkStats {
  daysUsed: number; budget: number; weekH: number; count: number
  earnMonth: number; earnYear: number; earnAll: number; avgRate: number
  byEmployer: EmployerStat[]; tone: 'red' | 'amber' | 'green'
}

export function computeWorkStats(shifts: Shift[]): WorkStats {
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
  const dayPct = daysUsed / 120, weekPct = weekH / 20
  const tone: 'red' | 'amber' | 'green' = dayPct >= 1 || weekPct >= 1 ? 'red' : dayPct >= 0.8 || weekPct >= 0.8 ? 'amber' : 'green'
  return { daysUsed, budget: 120, weekH, count, earnMonth, earnYear, earnAll, avgRate: yearPaidH > 0 ? earnYear / yearPaidH : 0, byEmployer, tone }
}
