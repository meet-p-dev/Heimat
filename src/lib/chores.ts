import type { SupabaseClient } from '@supabase/supabase-js'

/* The chores rota (docs/chores-screens.md; iOS: AppModel+Chores.swift). The database
   keeps the turns — who has which period, skips and swaps, missed and done — so every
   phone and the reminders agree; the app asks (my_chores) and acts through its functions. */

export interface Chore { id: string; flat_id: string; name: string; cadence: string; anchor_on: string; points: number; rota: string[] }
export interface ChoreTurn {
  chore_id: string; n: number; flat_id: string; starts_on: string; ends_on: string
  assignee: string | null; state: 'open' | 'done' | 'missed'; done_by: string | null; done_at: string | null; points: number | null
}
export interface ChoreSwap { id: string; chore_id: string; n: number; flat_id: string; from_user: string; to_user: string }
export type ChoreRow = Omit<Chore, 'id'>
export interface ChoreData { chores: Chore[]; turns: ChoreTurn[]; swaps: ChoreSwap[]; done: ChoreTurn[] }

export const CHORE_CADENCES: [string, string][] = [['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']]
export const SIZES: [number, string][] = [[1, 'Small'], [2, 'Medium'], [3, 'Big']]
export const EMPTY_CHORES: ChoreData = { chores: [], turns: [], swaps: [], done: [] }

export async function loadChores(sb: SupabaseClient, today: string): Promise<ChoreData | null> {
  const [c, t, s, d] = await Promise.all([
    sb.from('chores').select('*').is('archived_at', null).order('created_at'),
    sb.rpc('my_chores'),
    sb.from('chore_swaps').select('*').is('answer', null),
    sb.from('chore_turns').select('*').eq('state', 'done').gte('done_at', today.slice(0, 7) + '-01'),
  ])
  if (c.error || t.error || s.error || d.error) return null
  return { chores: c.data as Chore[], turns: t.data as ChoreTurn[], swaps: s.data as ChoreSwap[], done: d.data as ChoreTurn[] }
}

/* the database's own words ("chores: there is nobody to pass it to"), or a fallback */
export const choreError = (e: { message?: string } | null) =>
  e?.message?.startsWith('chores: ') ? e.message.slice(8, 9).toUpperCase() + e.message.slice(9) : "Couldn't do that right now — try again."

/* this period's turn (the earlier of the two the database keeps) and the next */
export function turnsOf(d: ChoreData, choreId: string) {
  const t = d.turns.filter((x) => x.chore_id === choreId).sort((a, b) => a.n - b.n)
  return { now: t[0] || null, next: t[1] || null }
}

/* your open turns in a group that have started: "Your turn: Bathroom" */
export const myTurns = (d: ChoreData, flatId: string, uid: string | null, today: string) =>
  d.chores.filter((c) => c.flat_id === flatId).filter((c) => {
    const t = turnsOf(d, c.id).now
    return !!t && t.assignee === uid && t.state === 'open' && t.starts_on <= today
  })

/* points this month, per person, highest first */
export function board(d: ChoreData, flatId: string) {
  const by = new Map<string, { points: number; done: number }>()
  for (const t of d.done) {
    if (t.flat_id !== flatId || !t.done_by) continue
    const x = by.get(t.done_by) || { points: 0, done: 0 }
    by.set(t.done_by, { points: x.points + (t.points || 0), done: x.done + 1 })
  }
  return [...by].map(([user, v]) => ({ user, ...v })).sort((a, b) => b.points - a.points || (a.user < b.user ? -1 : 1))
}
