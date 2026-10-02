import { useState, useEffect } from 'react'
import { Check, PlusCircle, Trophy, Sparkles } from 'lucide-react'
import type { Theme, Member } from '../lib/types'
import { isPending } from '../lib/types'
import type { Chore, ChoreTurn, ChoreSwap, ChoreRow, ChoreData } from '../lib/chores'
import { CHORE_PRESETS, SIZES, turnsOf, myTurns, board, parseCadence, cadenceOf, cadenceLabel, type Unit } from '../lib/chores'
import { relDay, tod } from '../lib/format'
import { haptic } from '../lib/haptic'
import { Sheet, Field, Btn, Card, SegmentedControl, Alert, Stepper } from './ui'

/* Chores (docs/chores-screens.md; iOS: ChoresViews.swift). */

export interface ChoresCtx {
  T: Theme; uid: string | null; d: ChoreData; members: Member[]
  who: (uid: string) => string
  edit: (c: Chore | null, flatId: string) => void
  call: (fn: 'chore_tick' | 'chore_skip' | 'chore_swap_ask' | 'chore_swap_answer', args: Record<string, unknown>, ok?: string) => Promise<void>
}

export function ChoresSection({ c, flatId }: { c: ChoresCtx; flatId: string }) {
  const { T } = c
  const list = c.d.chores.filter((x) => x.flat_id === flatId)
  const asks = c.d.swaps.filter((s) => s.flat_id === flatId && s.to_user === c.uid)
  const top = board(c.d, flatId)
  const [acting, setActing] = useState<Chore | null>(null)
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, margin: '0 4px 8px' }}>Chores</div>
      {asks.map((s) => <SwapAsk key={s.id} c={c} s={s} />)}
      <div className="glass h-group">
        {list.map((x) => <ChoreRowView key={x.id} c={c} chore={x} act={() => setActing(x)} />)}
        {top.length > 0 && (
          <div className="h-item" style={{ '--inset': '58px', fontSize: 13.5, fontWeight: 550 } as React.CSSProperties}>
            <Trophy size={20} color="#e3a008" style={{ width: 28, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>This month: {top.slice(0, 4).map((x) => `${x.user === c.uid ? 'you' : c.who(x.user)} ${x.points}`).join(' · ')}</span>
          </div>
        )}
        <button type="button" className="h-item" disabled={!c.uid} onClick={() => { haptic(8); c.edit(null, flatId) }} style={{ color: T.acc, fontWeight: 650 }}>
          <PlusCircle size={20} />
          <span style={{ flex: 1, textAlign: 'left' }}>{list.length ? 'Add chore' : 'Add bathroom, kitchen or trash'}</span>
        </button>
      </div>
      <ChoreActions c={c} chore={acting} onClose={() => setActing(null)} />
    </div>
  )
}

function ChoreRowView({ c, chore, act }: { c: ChoresCtx; chore: Chore; act: () => void }) {
  const { T } = c
  const [busy, setBusy] = useState(false)
  const { now, next } = turnsOf(c.d, chore.id)
  const today = tod()
  const started = !!now && now.starts_on <= today
  const done = now?.state === 'done'
  const mine = now?.assignee === c.uid && now?.state === 'open'
  const name = (u: string | null) => (!u ? 'nobody' : u === c.uid ? 'you' : c.who(u))
  const line = !now ? '' : done
    ? `Done ✓ by ${name(now.done_by)}${next?.assignee ? ` · next: ${name(next.assignee)}` : ''}`
    : !started ? `Starts ${relDay(now.starts_on)} · ${name(now.assignee)} first`
    : `${now.assignee === c.uid ? 'Your' : `${name(now.assignee)}'s`} turn · ${now.ends_on === today ? 'last day today' : `until ${relDay(now.ends_on)}`}`
  const tick = async () => {
    if (!now || !started || busy) return
    haptic(10); setBusy(true)
    await c.call('chore_tick', { p_chore: chore.id, p_n: now.n, p_done: !done })
    setBusy(false)
  }
  return (
    <div className="h-item" style={{ '--inset': '58px' } as React.CSSProperties}>
      <button type="button" onClick={tick} disabled={!started || busy} aria-label={done ? 'Done — tap to undo' : `Mark ${chore.name} as done`}
        style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, cursor: started ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: busy || !started ? 0.4 : 1,
          background: done ? T.green : 'transparent', border: done ? 'none' : `2px solid ${mine ? T.acc : T.border}`, color: '#fff' }}>
        {done && <Check size={16} strokeWidth={3} />}
      </button>
      <button type="button" onClick={() => { haptic(8); act() }}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, color: T.txt, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 650 }}>{chore.name}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: mine ? T.acc : T.txt3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
        </span>
        <span style={{ fontSize: 12, fontWeight: 650, color: T.txt2, padding: '3px 8px', borderRadius: 99, background: `color-mix(in srgb, ${T.txt3} 14%, transparent)` }}>{chore.points} pt{chore.points === 1 ? '' : 's'}</span>
      </button>
    </div>
  )
}

/* tapping a chore: skip, ask someone to take it, or edit */
function ChoreActions({ c, chore, onClose }: { c: ChoresCtx; chore: Chore | null; onClose: () => void }) {
  const { T } = c
  const t = chore ? turnsOf(c.d, chore.id) : { now: null as ChoreTurn | null, next: null as ChoreTurn | null }
  const mine = !!chore && t.now?.assignee === c.uid && t.now?.state === 'open'
  const others = chore ? c.members.filter((m) => m.flat_id === chore.flat_id && !m.left_at && !isPending(m) && m.user_id !== c.uid) : []
  const go = async (fn: Parameters<ChoresCtx['call']>[0], args: Record<string, unknown>, ok: string) => { onClose(); await c.call(fn, args, ok) }
  return (
    <Sheet open={!!chore} onClose={onClose} title={chore?.name || ''} T={T}>
      {mine && t.now && (
        <>
          <div style={{ fontSize: 13.5, color: T.txt2, margin: '0 4px 12px', lineHeight: 1.5 }}>Skip passes it on and your turn comes back next time. A swap changes only when they say yes.</div>
          <div className="glass h-group" style={{ marginBottom: 16 }}>
            {t.next?.assignee && t.next.assignee !== c.uid && (
              <button type="button" className="h-item" onClick={() => go('chore_skip', { p_chore: chore!.id, p_n: t.now!.n }, 'Skipped — it comes back to you next time')}>Skip this turn</button>
            )}
            {others.map((m) => (
              <button key={m.user_id} type="button" className="h-item" onClick={() => go('chore_swap_ask', { p_chore: chore!.id, p_n: t.now!.n, p_to: m.user_id }, `Asked ${m.display_name}`)}>Ask {m.display_name} to take it</button>
            ))}
          </div>
        </>
      )}
      <Btn full kind="secondary" onClick={() => { onClose(); if (chore) c.edit(chore, chore.flat_id) }}>Edit chore</Btn>
    </Sheet>
  )
}

function SwapAsk({ c, s }: { c: ChoresCtx; s: ChoreSwap }) {
  const { T } = c
  const name = c.d.chores.find((x) => x.id === s.chore_id)?.name || 'a chore'
  return (
    <Card T={T} style={{ padding: 14, borderRadius: 20, marginBottom: 10 }}>
      <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 10 }}>{c.who(s.from_user)} asks if you can take their turn: {name}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn size="sm" kind="secondary" onClick={() => c.call('chore_swap_answer', { p_swap: s.id, p_accept: false })}>Decline</Btn>
        <Btn size="sm" onClick={() => c.call('chore_swap_answer', { p_swap: s.id, p_accept: true })}>I'll do it</Btn>
      </div>
    </Card>
  )
}

/* the line on a group's card */
export function ChoreCardLine({ c, flatId }: { c: ChoresCtx; flatId: string }) {
  const mine = myTurns(c.d, flatId, c.uid, tod())
  const asks = c.d.swaps.filter((s) => s.flat_id === flatId && s.to_user === c.uid).length
  if (!mine.length && !asks) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5, fontWeight: 550, color: c.T.acc, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <Sparkles size={13} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{asks ? `${asks} swap ${asks === 1 ? 'request' : 'requests'} for you` : `Your turn: ${mine.map((x) => x.name).join(', ')}`}</span>
    </div>
  )
}

/* Monday of this week, for a new weekly chore */
const monday = () => {
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ChoreModal({ c, open, onClose, editing, flatId, save, remove }: {
  c: ChoresCtx; open: boolean; onClose: () => void; editing: Chore | null; flatId: string
  save: (id: string | null, row: ChoreRow) => Promise<string | null>; remove: (x: Chore) => void
}) {
  const { T } = c
  const people = c.members.filter((m) => m.flat_id === flatId && !m.left_at && !isPending(m))
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState('weekly')
  const [start, setStart] = useState(monday())
  const [points, setPoints] = useState('1')
  const [rota, setRota] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setErr(null); setBusy(false)
    setName(editing?.name || ''); setCadence(editing?.cadence || 'weekly'); setStart(editing?.anchor_on || monday())
    setPoints(String(editing?.points || 1))
    setRota(editing ? editing.rota.filter((u) => people.some((p) => p.user_id === u)) : people.map((p) => p.user_id))
  }, [open])
  const ok = !!name.trim() && rota.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(start) && !busy && !!c.uid
  const submit = async () => {
    if (!ok) return
    setBusy(true); setErr(null)
    const e = await save(editing?.id || null, { flat_id: flatId, name: name.trim(), cadence, anchor_on: start, points: Number(points), rota })
    setBusy(false)
    if (e) setErr(e); else onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit chore' : 'New chore'} T={T}
      footer={<>
        <Btn full disabled={!ok} busy={busy} onClick={submit}>Save</Btn>
        {editing && <Btn full kind="danger" size="md" onClick={() => { if (confirm(`Remove ${editing.name}? Its points this month stay.`)) { remove(editing); onClose() } }} style={{ marginTop: 4 }}>Remove chore</Btn>}
      </>}>
      <Field T={T} label="Name" htmlFor="ch-name"><input id="ch-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bathroom" /></Field>
      <Field T={T} label={`How often · ${cadenceLabel(cadence).toLowerCase()}`} hint="Pick one, or set any number of days, weeks or months.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {CHORE_PRESETS.map((p) => (
            <Btn key={p} size="sm" kind={cadence === p ? 'tinted' : 'ghost'} onClick={() => { haptic(6); setCadence(p) }}>{cadenceLabel(p)}</Btn>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15 }}>Every</span>
          <Stepper label="how many" value={parseCadence(cadence).n} min={1} max={99} onChange={(v) => setCadence(cadenceOf(v, parseCadence(cadence).unit))} />
          <div style={{ flex: 1 }}>
            <SegmentedControl T={T} label="Unit" options={[['d', 'Days'], ['w', 'Weeks'], ['m', 'Months']]} value={parseCadence(cadence).unit}
              onChange={(u) => setCadence(cadenceOf(parseCadence(cadence).n, u as Unit))} />
          </div>
        </div>
      </Field>
      <Field T={T} label="First turn starts" htmlFor="ch-start"><input id="ch-start" className="fld" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field T={T} label="Size" hint="Bigger chores earn more points on this month's table.">
        <SegmentedControl T={T} label="Size" options={SIZES.map(([n, l]) => [String(n), `${l} · ${n}`] as [string, string])} value={points} onChange={setPoints} />
      </Field>
      <Field T={T} label="Who takes part" hint="Turns go round in this order. Tap to take someone out or put them back at the end.">
        <div className="h-well" style={{ padding: 0 }}>
          {people.map((p, i) => {
            const at = rota.indexOf(p.user_id)
            return (
              <button key={p.user_id} type="button" onClick={() => { haptic(8); setRota(at >= 0 ? rota.filter((u) => u !== p.user_id) : [...rota, p.user_id]) }}
                style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '13px 16px', background: 'none', border: 'none', borderTop: i ? `1px solid ${T.border}` : 'none', color: T.txt, font: 'inherit', fontSize: 16, cursor: 'pointer' }}>
                <span style={{ flex: 1, textAlign: 'left' }}>{p.user_id === c.uid ? 'You' : p.display_name}</span>
                {at >= 0
                  ? <span style={{ width: 24, height: 24, borderRadius: 99, background: T.acc, color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{at + 1}</span>
                  : <span style={{ width: 24, height: 24, borderRadius: 99, border: `2px solid ${T.border}` }} />}
              </button>
            )
          })}
        </div>
      </Field>
      {err && <Alert T={T}>{err}</Alert>}
    </Sheet>
  )
}
