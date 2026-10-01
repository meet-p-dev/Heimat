import type { SupabaseClient } from '@supabase/supabase-js'
import { relDay, tod } from './format'

/* Bills (docs/bills-screens.md; iOS: AppModel+Bills.swift). The database works out
   due dates and states (my_bills), so the apps and the reminders always agree. A
   tick only says "paid" — it adds no expense. */

export interface Bill {
  id: string; flat_id: string | null; owner_id: string | null
  name: string; amount: number | null; currency: string; category: string
  cadence: string; anchor_on: string; payer: string | null
  contract_ends_on: string | null; notice_amount: number | null; notice_unit: 'week' | 'month' | null
}
export interface BillStatus {
  bill_id: string; due_on: string; state: 'upcoming' | 'due' | 'overdue' | 'paid'
  paid_on: string | null; paid_by: string | null; cancel_by: string | null
}
export type BillRow = Omit<Bill, 'id'>

export const CADENCES: [string, string][] = [['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']]

export async function loadBills(sb: SupabaseClient): Promise<{ bills: Bill[]; status: Record<string, BillStatus> } | null> {
  const [b, s] = await Promise.all([
    sb.from('bills').select('*').is('archived_at', null).order('created_at'),
    sb.rpc('my_bills'),
  ])
  if (b.error || s.error) return null
  return { bills: (b.data as Bill[]) || [], status: Object.fromEntries(((s.data as BillStatus[]) || []).map((x) => [x.bill_id, x])) }
}

/* the database's own words ("bills: who pays it must be in the group"), or a fallback */
export const billError = (e: { message?: string } | null) =>
  e?.message?.startsWith('bills: ') ? e.message.slice(7, 8).toUpperCase() + e.message.slice(8) : "Couldn't save that right now — try again."

export const billsIn = (bills: Bill[], status: Record<string, BillStatus>, flatId: string | null, uid: string | null) =>
  bills.filter((b) => b.flat_id === flatId && (flatId !== null || b.owner_id === uid))
    .sort((a, b) => (status[a.id]?.due_on || a.anchor_on).localeCompare(status[b.id]?.due_on || b.anchor_on) || a.name.localeCompare(b.name))

/* the one a card should mention: overdue first, then due, then the next coming up */
export function nextBill(bills: Bill[], status: Record<string, BillStatus>, flatId: string | null, uid: string | null) {
  const rank = { overdue: 0, due: 1, upcoming: 2, paid: 3 }
  return billsIn(bills, status, flatId, uid).filter((b) => status[b.id])
    .sort((a, b) => rank[status[a.id].state] - rank[status[b.id].state] || status[a.id].due_on.localeCompare(status[b.id].due_on))[0] || null
}

const daysUntil = (iso: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(tod() + 'T00:00:00').getTime()) / 86400000)

/* "Due today", "Overdue since 1 Oct", "Due in 3 days", "Paid ✓ by Nina · next 1 Nov" */
export function billLine(b: Bill, s: BillStatus | undefined, who: (uid: string) => string): { text: string; urgent: boolean } {
  if (!s) return { text: `Due ${relDay(b.anchor_on)}`, urgent: false }
  if (s.state === 'due') return { text: 'Due today', urgent: true }
  if (s.state === 'overdue') return { text: `Overdue since ${relDay(s.due_on)}`, urgent: true }
  if (s.state === 'paid') return { text: `Paid ✓ by ${s.paid_by ? who(s.paid_by) : 'someone'} · next ${relDay(s.due_on)}`, urgent: false }
  const d = daysUntil(s.due_on)
  return { text: d === 1 ? 'Due tomorrow' : d < 7 ? `Due in ${d} days` : `Due ${relDay(s.due_on)}`, urgent: false }
}

/* within two months of the last day to cancel a contract */
export const cancelSoon = (s: BillStatus | undefined) => !!s?.cancel_by && daysUntil(s.cancel_by) >= 0 && daysUntil(s.cancel_by) <= 60

export { cancelByOf } from './cancelBy'
