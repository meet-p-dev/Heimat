import { useState, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { PlusCircle, Pencil, Trash2, RotateCcw, ArrowRightLeft, UserPlus, UserX, Mail, RefreshCw, Clock, Split, ShoppingCart, CheckCircle2, FileText, Sparkles, History } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Theme } from '../lib/types'
import type { Activity, ActivityLook } from '../lib/activity'
import { isGone, lookOf, tintOf, sentenceOf } from '../lib/activity'
import { relDay, money } from '../lib/format'
import { Page, Chip, SectionLabel, EmptyState, TINT } from './ui'

const ICON: Record<ActivityLook, LucideIcon> = {
  add: PlusCircle, edit: Pencil, delete: Trash2, undo: RotateCcw, settle: ArrowRightLeft, person: UserPlus, personOff: UserX,
  invite: Mail, repeat: RefreshCw, pause: Clock, split: Split, cart: ShoppingCart, done: CheckCircle2, bill: FileText,
  chore: Sparkles, swap: RefreshCw, other: History,
}

/* the day it happened here, not in UTC (slicing the timestamp files anything after midnight under yesterday) */
const localDay = (at: string) => { const d = new Date(at); return isNaN(+d) ? at.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const timeOf = (at: string) => { const d = new Date(at); return isNaN(+d) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }

/* One line of Activity: what happened, in a sentence with the thing it happened to in
   bold; the group when the list mixes groups; when (the time on the page, the day on
   Home); the amount, struck through when it was undone. */
export function ActivityRow({ T, a, name, me, place, showsTime, currency }: {
  T: Theme; a: Activity; name: (u: string | null) => string; me: string | null
  /* the group's name, when the list mixes groups */
  place?: string; showsTime?: boolean; currency: string
}) {
  const I = ICON[lookOf(a.kind)]
  const gone = isGone(a)
  const { text, what } = sentenceOf(a, name, me)
  const at = what ? text.lastIndexOf(what) : -1
  return (
    <div className="h-item" style={{ alignItems: 'flex-start', '--inset': '56px' } as CSSProperties}>
      <span style={{ width: 28, display: 'flex', justifyContent: 'center', paddingTop: 1, color: gone ? T.txt3 : TINT[tintOf(a.kind)], flexShrink: 0 }}><I size={19} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14.5, lineHeight: 1.4 }}>
          {at >= 0 ? <>{text.slice(0, at)}<b style={{ fontWeight: 650 }}>{what}</b>{text.slice(at + what.length)}</> : text}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: T.txt3, marginTop: 2 }}>
          {showsTime ? timeOf(a.at) : relDay(localDay(a.at))}{place ? ` · ${place}` : ''}
        </span>
      </span>
      {a.amount != null && (
        <span style={{ fontSize: 14.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: gone ? T.txt3 : T.txt, textDecoration: gone ? 'line-through' : undefined, flexShrink: 0 }}>
          {money(a.amount, currency)}
        </span>
      )}
    </div>
  )
}

/* Everything that has happened in all your groups and non-group expenses, newest first,
   by day; chips narrow it to one group. Opened from Home's Activity. */
export function ActivityPage({ T, rows, loading, places, isCircle, name, me, placeName, curOf, onBack }: {
  T: Theme; rows: Activity[]; loading: boolean
  /* your groups by name, then non-group expenses if you have any */
  places: { id: string; name: string }[]; isCircle: (id: string) => boolean
  name: (u: string | null, place?: string) => string; me: string | null; placeName: (id: string) => string
  /* each place keeps its books in its own currency */
  curOf: (place: string) => string; onBack: () => void
}) {
  const NON = 'non-group'
  const [place, setPlace] = useState<string | null>(null)
  const shown = place == null ? rows : place === NON ? rows.filter((a) => isCircle(a.flat_id)) : rows.filter((a) => a.flat_id === place)
  const days = useMemo(() => {
    const out: { key: string; list: Activity[] }[] = []
    for (const a of shown) {
      const k = localDay(a.at)
      if (out[out.length - 1]?.key !== k) out.push({ key: k, list: [] })
      out[out.length - 1].list.push(a)
    }
    return out
  }, [shown])
  return (
    <Page T={T} title="Activity" onBack={onBack}>
      {places.length > 1 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -16px', padding: '2px 16px 4px' }}>
          <Chip T={T} on={place == null} onClick={() => setPlace(null)}>All</Chip>
          {places.map((p) => <Chip key={p.id} T={T} on={place === p.id} onClick={() => setPlace(p.id)}>{p.name}</Chip>)}
        </div>
      )}
      {shown.length === 0
        ? (!loading && <EmptyState T={T} icon={Clock} title="Nothing yet" body="Everything anyone adds, changes or ticks off in your groups shows up here." />)
        : days.map((d) => (
          <div key={d.key}>
            <SectionLabel T={T}>{relDay(d.key)}</SectionLabel>
            <div className="glass" style={{ borderRadius: 22, overflow: 'hidden' }}>
              {d.list.map((a) => <ActivityRow key={a.id} {...{ T, a, me }} currency={curOf(a.flat_id)} name={(u) => name(u, a.flat_id)} showsTime place={place == null && places.length > 1 ? placeName(a.flat_id) : undefined} />)}
            </div>
          </div>
        ))}
      {loading && shown.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: T.txt3 }}>Loading…</div>}
    </Page>
  )
}
