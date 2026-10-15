import { sb } from './supabase'

/* What happened in your groups and non-group expenses: rows the database writes
   from triggers (an expense added on the web, a bill ticked on a phone, a chore
   done from a widget all land here the same way). Read when someone comes to
   look — never pushed. The same sentences as the iPhone app (ActivityView.swift). */
export interface Activity {
  id: string; flat_id: string; actor: string | null; kind: string
  subject: string | null; amount: number | null; at: string
  /* who else it is about: `to` (a chore passed on, a swap asked of someone) or `from` */
  meta?: Record<string, unknown> | null
}

export async function loadActivity(places: string[]): Promise<Activity[] | null> {
  if (!sb || !places.length) return []
  const { data, error } = await sb.from('activity').select('*').in('flat_id', places).order('at', { ascending: false }).limit(400)
  return error ? null : ((data as Activity[]) || [])
}

/* who joined or left, invites and the debt setting: what a non-group circle does
   behind the scenes when you add a friend — not shown for those */
const HOUSEKEEPING = new Set(['joined', 'left', 'invited', 'invite_withdrawn', 'simplify_on', 'simplify_off'])
export const visibleActivity = (rows: Activity[], isCircle: (id: string) => boolean) =>
  rows.filter((a) => !(HOUSEKEEPING.has(a.kind) && isCircle(a.flat_id)))

/* undone, deleted or left: drawn quieter, the amount struck through */
export const isGone = (a: Activity) => ['expense_deleted', 'left', 'invite_withdrawn', 'settle_undone', 'item_removed', 'bill_removed',
  'bill_unpaid', 'chore_removed', 'chore_undone', 'recurring_deleted', 'recurring_stopped', 'swap_declined'].includes(a.kind)

export type ActivityLook = 'add' | 'edit' | 'delete' | 'undo' | 'settle' | 'person' | 'personOff' | 'invite' | 'repeat' | 'pause' | 'split' | 'cart' | 'done' | 'bill' | 'chore' | 'swap' | 'other'
export function lookOf(kind: string): ActivityLook {
  switch (kind) {
    case 'expense_added': case 'imported': return 'add'
    case 'expense_edited': case 'renamed': return 'edit'
    case 'expense_deleted': return 'delete'
    case 'expense_restored': case 'settle_undone': case 'chore_undone': return 'undo'
    case 'settled': return 'settle'
    case 'joined': return 'person'
    case 'invited': return 'invite'
    case 'left': case 'invite_withdrawn': return 'personOff'
    case 'recurring_added': case 'recurring_edited': return 'repeat'
    case 'recurring_deleted': case 'recurring_stopped': case 'recurring_paused': return 'pause'
    case 'simplify_on': case 'simplify_off': return 'split'
    case 'item_added': case 'item_removed': return 'cart'
    case 'item_bought': case 'bill_paid': case 'chore_done': return 'done'
    case 'bill_added': case 'bill_edited': case 'bill_removed': case 'bill_unpaid': return 'bill'
    case 'chore_added': case 'chore_edited': case 'chore_removed': return 'chore'
    case 'chore_skipped': case 'swap_asked': case 'swap_accepted': case 'swap_declined': return 'swap'
    default: return 'other'
  }
}

/* the part of group life it belongs to, for its colour (ui.tsx TINT keys) */
export function tintOf(kind: string): 'pink' | 'orange' | 'teal' | 'indigo' | 'blue' | 'green' {
  if (kind.startsWith('item_')) return 'pink'
  if (kind.startsWith('bill_')) return 'orange'
  if (kind.startsWith('chore_') || kind.startsWith('swap_')) return 'teal'
  if (['joined', 'invited', 'left', 'invite_withdrawn'].includes(kind)) return 'indigo'
  if (kind === 'settled' || kind === 'settle_undone') return 'blue'
  return 'green'
}

/* "Nina bought Oat milk": the sentence, and the thing it happened to (shown in bold) */
export function sentenceOf(a: Activity, name: (u: string | null) => string, me: string | null): { text: string; what: string } {
  const who = a.actor == null ? 'Splitlife' : name(a.actor)
  const what = a.subject || ''
  // mid-sentence, you are "you"
  const mid = (u: unknown) => (typeof u === 'string' && u === me ? 'you' : name(typeof u === 'string' ? u : null))
  const to = mid(a.meta?.to), from = mid(a.meta?.from)
  const exp = what || 'an expense'
  const t: Record<string, string> = {
    expense_added: `${who} added ${exp}`, expense_edited: `${who} changed ${exp}`, expense_deleted: `${who} deleted ${exp}`,
    expense_restored: `${who} brought back ${exp}`, settled: `${who} settled up with ${what}`, settle_undone: `${who} undid a payment to ${what}`,
    joined: `${what} joined`, invited: `${who} invited ${what}`, left: `${what} left`, invite_withdrawn: `${who} withdrew the invite to ${what}`,
    recurring_added: `${who} set ${what} to repeat`, recurring_edited: `${who} changed the repeating ${what}`, recurring_deleted: `${who} stopped repeating ${what}`,
    recurring_paused: `Repeating ${what} was paused`, recurring_stopped: `Repeating ${what} stopped`,
    simplify_on: `${who} turned on simplified debts`, simplify_off: `${who} turned off simplified debts`,
    item_added: `${who} added ${what} to the list`, item_bought: `${who} bought ${what}`, item_removed: `${who} took ${what} off the list`,
    bill_added: `${who} added the bill ${what}`, bill_edited: `${who} changed the bill ${what}`, bill_removed: `${who} removed the bill ${what}`,
    bill_paid: `${who} marked ${what} as paid`, bill_unpaid: `${who} marked ${what} as not paid`,
    chore_added: `${who} added the chore ${what}`, chore_edited: `${who} changed the chore ${what}`, chore_removed: `${who} removed the chore ${what}`,
    chore_done: `${who} did ${what}`, chore_undone: `${who} un-ticked ${what}`, chore_skipped: `${who} passed ${what} on to ${to}`,
    renamed: `${who} renamed the group to ${what}`,
    imported: `${who} brought ${Number(a.meta?.expenses) || 0} expenses over from ${what || 'Splitwise'}`,
    swap_asked: `${who} asked ${to} to take ${what}`, swap_accepted: `${who} took over ${what} from ${from}`, swap_declined: `${who} couldn't take ${what} for ${from}`,
  }
  return { text: t[a.kind] || `${who} changed something`, what: a.kind.startsWith('expense_') && !what ? '' : what }
}
