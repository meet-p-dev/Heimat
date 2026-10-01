/*
  Talking to the database about friends — the web's copy of the writing half of
  ios-native/Heimat/AppModel+Friends.swift. Each returns null on success or a
  sentence for a person to read.
*/
import { sb } from './supabase'
import type { Flat, SplitData, SplitType } from './types'
import { spread, toMajor } from './ledger'
import type { SpreadPart } from './ledger'
import { pickJson } from './places'
import type { PersonPick, PlaceLine } from './places'
import { tod } from './format'

/* the server's own words, readable: "friends: …" and "split: …" refusals become a sentence */
export function friendsMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const m = error?.message || ''
  if (m.includes('not someone you know')) return 'You can only pick people you share a group with — add anyone else by email.'
  if (m.includes("isn't on the expense")) return 'Everyone you picked has to be on the expense — remove them, or include them in the split.'
  if (m.includes('not_in_flat')) return "Someone on this expense isn't one of the people you picked."
  if (m.startsWith('friends: ')) { const r = m.slice(9); return r[0].toUpperCase() + r.slice(1) }
  if (m && /^[A-Z]/.test(m) && !/function|relation|permission denied/.test(m)) return m
  return fallback
}

/* whether an address is on Heimat, and the name they use (shown, as Splitwise does) */
export async function findPerson(email: string): Promise<{ onHeimat: boolean; name: string | null } | string> {
  if (!sb) return 'Offline'
  const { data, error } = await sb.rpc('find_person', { p_email: email.trim() })
  if (error) return friendsMessage(error, "Couldn't look that address up right now.")
  const row = (data as { on_heimat: boolean; name: string | null }[] | null)?.[0]
  return { onHeimat: !!row?.on_heimat, name: row?.name || null }
}

/* the circle for you and these people, found or made */
export async function friendCircle(picks: PersonPick[]): Promise<Flat | string> {
  if (!sb) return 'Offline'
  const { data, error } = await sb.rpc('friend_circle', { p_people: picks.map(pickJson) })
  if (error) return friendsMessage(error, "Couldn't add them right now — try again.")
  return data as Flat
}

export interface FriendExpense {
  description: string; amount: number; currency: string; paid_by: string; split_among: string[]
  split_type: SplitType; split: SplitData | null; payers: Record<string, number> | null; category: string; spent_on: string
}

/* add or edit an expense outside any group: the server finds or makes the circle for
   you and `people`, and moves the expense there when its people change */
export async function saveFriendExpense(id: string, people: string[], x: FriendExpense): Promise<string | null> {
  if (!sb) return 'Offline'
  const { error } = await sb.rpc('save_friend_expense', { p_id: id, p_people: people.map((u) => ({ user_id: u })), p_expense: x })
  return error ? friendsMessage(error, "Couldn't save — try again.") : null
}

/* the payments one settle-up with `person` records: spread over every place you owe
   each other in, so each place's balances stay right (spread() in lib/ledger.ts) */
export function settleParts(lines: PlaceLine[], currency: string, pay: number, iPay: boolean, pair: string | null): SpreadPart[] {
  const places = lines.filter((l) => l.currency === currency).map((l) => ({ place: l.place, owed: iPay ? -l.minor : l.minor }))
  return spread(pay, places, pair || PAIR)
}
export const PAIR = '\u0000pair'

/* one payment with `person`, written in one request: all of it lands, or none */
export async function settleWithPerson(uid: string, person: string, personName: string, lines: PlaceLine[], currency: string, pay: number, iPay: boolean, pair: string | null): Promise<string | null> {
  if (!sb) return 'Offline'
  let parts = settleParts(lines, currency, pay, iPay, pair)
  if (parts.some((p) => p.place === PAIR)) {
    const c = await friendCircle([{ userId: person, name: personName }])
    if (typeof c === 'string') return c
    parts = parts.map((p) => (p.place === PAIR ? { ...p, place: c.id } : p))
  }
  const payer = iPay ? uid : person, payee = iPay ? person : uid
  const rows = parts.map((p) => ({
    flat_id: p.place, from_user: p.reverse ? payee : payer, to_user: p.reverse ? payer : payee,
    amount: toMajor(p.minor, currency), currency, created_by: uid, settled_on: tod(),
  }))
  const { error } = await sb.from('settlements').insert(rows)
  return error ? friendsMessage(error, "Couldn't record that payment — try again.") : null
}

/* a reminder from the place they owe you most, non-group first (once a day, over 0,50 €) */
export async function remind(person: string, lines: PlaceLine[], isCircle: (id: string) => boolean, mainCurrencyOf: (id: string) => string): Promise<string | null> {
  if (!sb) return 'Offline'
  const owed = lines.filter((l) => l.minor > 0 && l.currency === mainCurrencyOf(l.place))
    .sort((a, b) => (isCircle(a.place) !== isCircle(b.place) ? (isCircle(a.place) ? -1 : 1) : b.minor - a.minor || (a.place < b.place ? -1 : 1)))
  if (!owed.length) return "They don't owe you anything right now"
  const { error } = await sb.rpc('nudge', { p_flat: owed[0].place, p_uid: person })
  return error ? friendsMessage(error, "Couldn't send that reminder.") : null
}
