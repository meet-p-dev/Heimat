import { useState, useEffect } from 'react'
import { Check, Trophy, Sparkles, User } from 'lucide-react'
import type { Theme, Member } from '../lib/types'
import { isPending } from '../lib/types'
import type { Chore, ChoreTurn, ChoreSwap, ChoreRow, ChoreData } from '../lib/chores'
import { CHORE_PRESETS, SIZES, turnsOf, myTurns, board, parseCadence, cadenceOf, cadenceLabel, type Unit } from '../lib/chores'
import { relDay, tod } from '../lib/format'
import { haptic } from '../lib/haptic'
import { Sheet, Field, Btn, SegmentedControl, Alert, Stepper, SectionLabel, Avatar, TINT } from './ui'
import { AddLink, EmptyPrompt } from './Bills'

/* Chores (docs/chores-screens.md; iOS: ChoresViews.swift). */

export interface ChoresCtx {
  T: Theme; uid: string | null; d: ChoreData; members: Member[]
  who: (uid: string) => string
  /* your own name, for your face (who() says "You") */
  meName?: string
  edit: (c: Chore | null, flatId: string) => void
  call: (fn: 'chore_tick' | 'chore_skip' | 'chore_swap_ask' | 'chore_swap_answer', args: Record<string, unknown>, ok?: string) => Promise<void>
}

/* A group's chores. Each row shows whose turn it is — their face — and what to do:
   "Done" when it's yours, a green tick once someone did it. Requests to take someone's
   turn sit at the top until you answer; this month's points close the card. Tap a chore
   for the rest: mark it done for someone, skip, ask someone to swap, edit. */
export function ChoresSection({ c, flatId }: { c: ChoresCtx; flatId: string }) {
  const { T } = c
  const today = tod()
  // yours first, then the ones still open, done last
  const rank = (x: Chore) => {
    const now = turnsOf(c.d, x.id).now
    if (!now) return 2
    if (now.state === 'done') return 3
    return now.assignee === c.uid && now.starts_on <= today ? 0 : 1
  }
  const list = c.d.chores.filter((x) => x.flat_id === flatId).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const asks = c.d.swaps.filter((s) => s.flat_id === flatId && s.to_user === c.uid)
  const top = board(c.d, flatId)
  const [acting, setActing] = useState<Chore | null>(null)
  const add = () => { haptic(8); c.edit(null, flatId) }
  return (
    <div style={{ marginBottom: 8 }}>
      <SectionLabel T={T} right={list.length > 0 && <AddLink onClick={add} disabled={!c.uid} />}>Chores</SectionLabel>
      <div className="glass h-group">
        {list.length === 0
          ? <EmptyPrompt T={T} icon={Sparkles} tint={TINT.teal} title="Take turns" text="Bathroom, kitchen, trash — Splitlife keeps the rota and tells each person when it's their turn." action="Add a chore" onClick={add} disabled={!c.uid} />
          : <>
            {asks.map((s) => <SwapAsk key={s.id} c={c} s={s} />)}
            {list.map((x) => <ChoreRowView key={x.id} c={c} chore={x} act={() => setActing(x)} />)}
            {top.length > 0 && (
              <div className="h-item" style={{ '--inset': '66px', gap: 10, minHeight: 48 } as React.CSSProperties}>
                <span style={{ width: 38, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Trophy size={17} color="#e3a008" /></span>
                <span style={{ fontSize: 13, fontWeight: 650, color: T.txt2, flexShrink: 0 }}>This month</span>
                <span style={{ display: 'flex', gap: 10, overflowX: 'auto', minWidth: 0 }}>
                  {top.slice(0, 6).map((x) => (
                    <span key={x.user} aria-label={`${x.user === c.uid ? 'You' : c.who(x.user)}: ${x.points} points`} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <Avatar name={x.user === c.uid ? c.meName : c.who(x.user)} seed={x.user} size={20} />
                      <span style={{ fontSize: 13, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{x.points}</span>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </>}
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
  const face = done ? now?.done_by : now?.assignee
  const name = (u: string | null | undefined) => (!u ? 'nobody' : u === c.uid ? 'you' : c.who(u))
  const line = !now ? cadenceLabel(chore.cadence) : done
    ? `Done by ${name(now.done_by)}${next?.assignee ? ` · next: ${name(next.assignee)}` : ''}`
    : !started ? `Starts ${relDay(now.starts_on)} · ${name(now.assignee)} first`
    : `${now.assignee === c.uid ? 'Your turn' : now.assignee ? `${c.who(now.assignee)}'s turn` : "Nobody's turn"} · ${now.ends_on === today ? 'last day today' : `until ${relDay(now.ends_on)}`}`
  const tick = async () => {
    if (!now || busy) return
    haptic(10); setBusy(true)
    await c.call('chore_tick', { p_chore: chore.id, p_n: now.n, p_done: true })
    setBusy(false)
  }
  return (
    <div className="h-item" style={{ '--inset': '66px', paddingRight: 12 } as React.CSSProperties}>
      <button type="button" onClick={() => { haptic(8); act() }}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', padding: 0, color: T.txt, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ position: 'relative', flexShrink: 0 }}>
          {face
            ? <Avatar name={face === c.uid ? c.meName : c.who(face)} seed={face} size={38} />
            : <span style={{ width: 38, height: 38, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.txt3, background: `color-mix(in srgb, ${T.txt3} 14%, transparent)` }}><User size={18} /></span>}
          {done && <span style={{ position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 99, background: T.green, color: '#fff', border: `2px solid ${T.bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={10} strokeWidth={3.4} /></span>}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chore.name}</span>
            <span style={{ fontSize: 11, fontWeight: 650, color: T.txt2, padding: '2px 6px', borderRadius: 99, background: `color-mix(in srgb, ${T.txt3} 14%, transparent)`, flexShrink: 0 }}>{chore.points} pt{chore.points === 1 ? '' : 's'}</span>
          </span>
          <span style={{ display: 'block', fontSize: 12.5, color: mine && started ? T.acc : T.txt3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
        </span>
      </button>
      {mine && started && <Btn size="sm" busy={busy} onClick={tick} ariaLabel={`Mark ${chore.name} as done`} style={{ flexShrink: 0 }}>Done</Btn>}
    </div>
  )
}

/* tapping a chore: undo, "I did it" for someone else, skip, ask someone to take it, or edit */
function ChoreActions({ c, chore, onClose }: { c: ChoresCtx; chore: Chore | null; onClose: () => void }) {
  const { T } = c
  const t = chore ? turnsOf(c.d, chore.id) : { now: null as ChoreTurn | null, next: null as ChoreTurn | null }
  const started = !!t.now && t.now.starts_on <= tod()
  const done = t.now?.state === 'done'
  const mine = !!chore && t.now?.assignee === c.uid && t.now?.state === 'open'
  const others = chore ? c.members.filter((m) => m.flat_id === chore.flat_id && !m.left_at && !isPending(m) && m.user_id !== c.uid) : []
  const go = async (fn: Parameters<ChoresCtx['call']>[0], args: Record<string, unknown>, ok?: string) => { onClose(); await c.call(fn, args, ok) }
  const rows: { label: string; run: () => void }[] = []
  if (chore && t.now && started) {
    if (done) rows.push({ label: 'Not done after all', run: () => go('chore_tick', { p_chore: chore.id, p_n: t.now!.n, p_done: false }) })
    // someone did it for them: it counts for whoever ticks it
    else if (!mine) rows.push({ label: 'I did it', run: () => go('chore_tick', { p_chore: chore.id, p_n: t.now!.n, p_done: true }) })
  }
  if (chore && mine && t.now) {
    if (t.next?.assignee && t.next.assignee !== c.uid) rows.push({ label: 'Skip this turn', run: () => go('chore_skip', { p_chore: chore.id, p_n: t.now!.n }, 'Skipped — it comes back to you next time') })
    for (const m of others) rows.push({ label: `Ask ${m.display_name} to take it`, run: () => go('chore_swap_ask', { p_chore: chore.id, p_n: t.now!.n, p_to: m.user_id }, `Asked ${m.display_name}`) })
  }
  const note = mine ? 'Skip passes it to whoever is next, and your turn comes back after. A swap only happens when they say yes.'
    : !done && started ? '"I did it" counts the points for you.' : null
  return (
    <Sheet open={!!chore} onClose={onClose} title={chore?.name || ''} T={T}>
      {note && <div style={{ fontSize: 13.5, color: T.txt2, margin: '0 4px 12px', lineHeight: 1.5 }}>{note}</div>}
      <div className="glass h-group" style={{ marginBottom: 8 }}>
        {rows.map((r) => <button key={r.label} type="button" className="h-item" onClick={r.run}>{r.label}</button>)}
        <button type="button" className="h-item" onClick={() => { onClose(); if (chore) c.edit(chore, chore.flat_id) }}>Edit chore</button>
      </div>
    </Sheet>
  )
}

/* "Dana asks you to take Vacuuming" — No / Take it, inside the Chores card */
function SwapAsk({ c, s }: { c: ChoresCtx; s: ChoreSwap }) {
  const { T } = c
  const name = c.d.chores.find((x) => x.id === s.chore_id)?.name || 'a chore'
  return (
    <div className="h-item" style={{ background: `color-mix(in srgb, ${T.acc} 9%, transparent)`, gap: 12, flexWrap: 'wrap', paddingRight: 12 }}>
      <Avatar name={c.who(s.from_user)} seed={s.from_user} size={38} />
      <span style={{ flex: 1, minWidth: 140, fontSize: 14, lineHeight: 1.4 }}><b>{c.who(s.from_user)}</b> asks you to take <b>{name}</b></span>
      <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        <Btn size="sm" kind="secondary" onClick={() => c.call('chore_swap_answer', { p_swap: s.id, p_accept: false })}>No</Btn>
        <Btn size="sm" onClick={() => c.call('chore_swap_answer', { p_swap: s.id, p_accept: true })}>Take it</Btn>
      </span>
    </div>
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
