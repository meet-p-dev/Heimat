/*
  Groups and friends, read from the same per-place books — the web's copy of
  ios-native/Heimat/AppModel+Friends.swift (see docs/friends-screens.md).

  A "place" is a group (a flat is just a group) or a hidden circle: the flats row
  of kind 'direct' behind expenses outside any group, whose members are exactly
  the people on them. Every place keeps its own books; what you and one person
  owe each other is the pairwise figure summed over the places you share, per
  currency — never one currency added to another.
*/
import type { Flat, Member, Expense, Settlement } from './types'
import { buildLedger, pairwiseFor } from './ledger'
import type { Ledger } from './ledger'

export interface PlaceLine { place: string; currency: string; minor: number }   // positive: they owe you
export interface Amount { currency: string; minor: number }
export interface FriendLine { userId: string; name: string; pending: boolean; amounts: Amount[] }
export interface Known { userId: string; name: string; email: string | null; pending: boolean }

/* someone picked for an expense outside any group: a known person, an email address, or just a name */
export interface PersonPick { userId?: string; email?: string; name: string }
export const pickKey = (p: PersonPick) => p.userId || (p.email ? 'mail:' + p.email : 'name:' + p.name)
export const pickJson = (p: PersonPick) => (p.userId ? { user_id: p.userId } : p.email ? { email: p.email, name: p.name } : { name: p.name })

export const isDirect = (f: Flat) => f.kind === 'direct'

/* every group's and circle's books, by its id */
export function placeBooks(expenses: Expense[], settles: Settlement[], fallback: string): Map<string, Ledger> {
  const ex = new Map<string, Expense[]>(), st = new Map<string, Settlement[]>()
  for (const e of expenses) ex.set(e.flat_id, [...(ex.get(e.flat_id) || []), e])
  for (const s of settles) st.set(s.flat_id, [...(st.get(s.flat_id) || []), s])
  const out = new Map<string, Ledger>()
  for (const id of [...new Set([...ex.keys(), ...st.keys()])].sort()) out.set(id, buildLedger(ex.get(id) || [], st.get(id) || [], fallback))
  return out
}

/* the name someone goes by: their own, from a group they joined, before an invitee's */
export function personName(members: Member[], u: string): string {
  const rows = members.filter((m) => m.user_id === u)
  return (rows.find((m) => m.claimed_at) || rows[0])?.display_name || 'Someone'
}

/* your money with `person`, place by place and currency by currency */
export function linesWith(books: Map<string, Ledger>, uid: string | null, person: string, places?: string[]): PlaceLine[] {
  if (!uid) return []
  const out: PlaceLine[] = []
  for (const id of (places || [...books.keys()]).slice().sort()) {
    const l = books.get(id)
    if (!l) continue
    for (const b of l.books.values()) {
      const v = pairwiseFor(b.owes, uid).get(person) || 0
      if (v !== 0) out.push({ place: id, currency: b.currency, minor: v })
    }
  }
  return out
}

/* lines added up per currency: `main` first, then the largest */
export function totals(lines: PlaceLine[], main: string): Amount[] {
  const by = new Map<string, number>()
  for (const l of lines) by.set(l.currency, (by.get(l.currency) || 0) + l.minor)
  return [...by].filter(([, v]) => v !== 0)
    .sort((a, b) => (a[0] === main) !== (b[0] === main) ? (a[0] === main ? -1 : 1) : Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([currency, minor]) => ({ currency, minor }))
}

/* everyone you have a non-group expense with — money outside every group only */
export function friendLines(circles: Flat[], members: Member[], books: Map<string, Ledger>, uid: string | null, main: string): FriendLine[] {
  const ids = circles.map((c) => c.id)
  const people = [...new Set(members.filter((m) => ids.includes(m.flat_id) && m.user_id !== uid).map((m) => m.user_id))]
  return people.map((u) => ({
    userId: u, name: personName(members, u),
    pending: !members.some((m) => m.user_id === u && m.claimed_at),
    amounts: totals(linesWith(books, uid, u, ids), main),
  })).sort((a, b) => Math.abs(b.amounts[0]?.minor || 0) - Math.abs(a.amounts[0]?.minor || 0) || a.name.localeCompare(b.name))
}

/* everyone you could split with: an invite that was declined or withdrawn is nobody */
export function knownPeople(members: Member[], uid: string | null): Known[] {
  const seen = new Map<string, Known>()
  for (const m of members) {
    if (m.user_id === uid) continue
    const dead = !m.claimed_at && (!!m.left_at || (!m.invite_token && !m.invite_email))
    if (dead) continue
    const k: Known = { userId: m.user_id, name: personName(members, m.user_id), email: m.claimed_at ? null : m.invite_email || null, pending: !m.claimed_at }
    const had = seen.get(m.user_id)
    if (!had || (had.pending && !k.pending)) seen.set(m.user_id, k)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/* the circle that is just you and `person` */
export function pairCircle(circles: Flat[], members: Member[], uid: string | null, person: string): string | null {
  if (!uid) return null
  for (const c of circles) {
    const rows = members.filter((m) => m.flat_id === c.id)
    const ids = new Set(rows.map((m) => m.user_id))
    if (ids.size === 2 && ids.has(uid) && ids.has(person) && !rows.some((m) => m.left_at)) return c.id
  }
  return null
}

/* expenses both of you are on, anywhere (they arrive newest first) */
export function sharedExpenses(expenses: Expense[], uid: string | null, person: string): Expense[] {
  if (!uid) return []
  return expenses.filter((e) => {
    const on = new Set([...(e.split_among || []), e.paid_by, ...Object.keys(e.payers || {}), ...Object.keys(e.shares || {})])
    return on.has(uid) && on.has(person)
  })
}
