/*
  The six ways a bill can be divided and "paid by several people" — the web's
  copy of ios-native/Heimat/SplitEditor.swift, worked out by computeShares in
  lib/ledger.ts (docs/money-engine.md, "Splitting one expense").

  What the person types is kept as text and read into whole minor units only
  when needed, so a half-typed "12," is never rounded behind their back.
*/
import type { CSSProperties } from 'react'
import { Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { Theme, Expense, SplitType, SplitData, SplitItem } from '../lib/types'
import { allocate, minorToInput, parseMinor, toMajor, participantsOf, cmp as cmpId } from '../lib/ledger'
import type { SplitSpec, SplitResult } from '../lib/ledger'
import { money } from '../lib/format'
import { SegmentedControl, Avatar, CheckCircle, Field } from './ui'

export const MODES: [SplitType, string][] = [['equal', 'Equal'], ['exact', 'Exact'], ['percent', '%'], ['shares', 'Shares'], ['adjust', '±'], ['itemized', 'Items']]
export const MODE_TITLE: Record<SplitType, string> = { equal: 'equally', exact: 'by exact amounts', percent: 'by percentage', shares: 'by shares', adjust: 'by adjustment', itemized: 'by item' }
const HINT: Record<SplitType, string> = {
  equal: 'Everyone ticked pays the same.',
  exact: 'Type what each person owes. It has to add up to the total.',
  percent: 'Give each person a percentage. Together they make 100 %.',
  shares: 'Give each person a number of shares — 2 for a couple, 1 for everyone else.',
  adjust: 'Add or take off an amount for someone (say, +5 for their extra drink). The rest is split equally.',
  itemized: "Add the receipt's lines and tick who had each. Tax, tip and discount are shared in proportion.",
}

export interface Line { id: string; label: string; amount: string; among: string[] }
export interface SplitState {
  mode: SplitType
  among: string[]
  exact: Record<string, string>; percent: Record<string, string>; shares: Record<string, string>; adjust: Record<string, string>
  lines: Line[]; tax: string; tip: string; discount: string
  severalPaid: boolean; paid: Record<string, string>
}

let lineN = 0
const lineId = () => 'l' + ++lineN
export const emptySplit = (among: string[]): SplitState => ({
  mode: 'equal', among, exact: {}, percent: {}, shares: {}, adjust: {}, lines: [], tax: '', tip: '', discount: '', severalPaid: false, paid: {},
})

/* what was typed, in minor units: nothing typed is 0, null is "that isn't an amount" */
const read = (s: string, cur: string) => (s.trim() === '' ? 0 : parseMinor(s, cur))

export function buildSpec(s: SplitState, cur: string): { spec: SplitSpec; unreadable?: string } {
  let unreadable: string | undefined
  const values = (texts: Record<string, string>, who: string[], as: string) => {
    const out: Record<string, number> = {}
    for (const u of who) {
      const t = texts[u]
      if (!t || !t.trim()) continue
      const v = read(t, as)
      if (v == null) { unreadable = unreadable || u; continue }
      out[u] = v
    }
    return out
  }
  switch (s.mode) {
    case 'equal': return { spec: { type: 'equal', among: s.among } }
    case 'exact': return { spec: { type: 'exact', values: values(s.exact, Object.keys(s.exact), cur) }, unreadable }
    // hundredths of a percent are basis points: "33,34" → 3334
    case 'percent': return { spec: { type: 'percent', values: values(s.percent, Object.keys(s.percent), 'EUR') }, unreadable }
    case 'shares': {
      // "1,5" → 150 hundredths → the weight 1.5, as the database stores it
      const w = values(s.shares, Object.keys(s.shares), 'EUR')
      return { spec: { type: 'shares', values: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / 100])) }, unreadable }
    }
    case 'adjust': return { spec: { type: 'adjust', among: s.among, values: values(s.adjust, s.among, cur) }, unreadable }
    case 'itemized': {
      const items: SplitItem[] = []
      for (const l of s.lines) {
        const v = read(l.amount, cur)
        if (v == null) { unreadable = unreadable || 'item'; continue }
        items.push({ ...(l.label.trim() ? { label: l.label.trim() } : {}), minor: v, among: [...l.among].sort(cmpId) })
      }
      const extra = (t: string, key: string) => { const v = read(t, cur); if (v == null) { unreadable = unreadable || key; return undefined } return v || undefined }
      return { spec: { type: 'itemized', items, tax: extra(s.tax, 'tax'), tip: extra(s.tip, 'tip'), discount: extra(s.discount, 'discount') }, unreadable }
    }
  }
}

/* expenses.split for this split — nothing for an equal one, which split_among says all of */
export function splitData(s: SplitState, spec: SplitSpec): SplitData | null {
  if (s.mode === 'equal') return null
  if (s.mode === 'itemized') return { items: [...(spec.items || [])], ...(spec.tax ? { tax: spec.tax } : {}), ...(spec.tip ? { tip: spec.tip } : {}), ...(spec.discount ? { discount: spec.discount } : {}) }
  return { values: { ...(spec.values || {}) } }
}

/* minor units each person paid when several did; null: one of them isn't an amount */
export function payersOf(s: SplitState, cur: string): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const [u, t] of Object.entries(s.paid)) {
    if (!t.trim()) continue
    const v = read(t, cur)
    if (v == null) return null
    if (v) out[u] = v
  }
  return out
}

/* switching to a mode for the first time starts it where the equal split stood */
export function startMode(s: SplitState, m: SplitType, total: number, cur: string, seed: string): SplitState {
  const who = [...s.among].sort(cmpId)
  const blank = (r: Record<string, string>) => Object.values(r).every((v) => !v)
  const n = { ...s, mode: m }
  if (!who.length) return n
  if (m === 'exact' && blank(s.exact) && total > 0) n.exact = Object.fromEntries([...allocate(total, who, seed)].map(([u, v]) => [u, minorToInput(v, cur)]))
  if (m === 'percent' && blank(s.percent)) n.percent = Object.fromEntries([...allocate(10000, who, seed)].map(([u, v]) => [u, minorToInput(v, 'EUR')]))
  if (m === 'shares' && blank(s.shares)) n.shares = Object.fromEntries(who.map((u) => [u, '1']))
  if (m === 'itemized' && !s.lines.length) n.lines = [{ id: lineId(), label: '', amount: '', among: [...s.among] }]
  return n
}

/* the state an existing expense was saved in */
export function fromExpense(e: Expense): SplitState {
  const cur = e.currency
  const s = emptySplit(participantsOf(e))
  s.mode = (e.split_type || 'equal') as SplitType
  const vals = e.split?.values || {}
  const int = (v: number) => Math.round(v)
  const map = (f: (v: number) => string) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, f(v)]))
  if (s.mode === 'exact') s.exact = map((v) => minorToInput(int(v), cur))
  if (s.mode === 'percent') s.percent = map((v) => minorToInput(int(v), 'EUR'))
  if (s.mode === 'shares') s.shares = map((v) => minorToInput(int(v * 100), 'EUR').replace(/,00$/, ''))
  if (s.mode === 'adjust') s.adjust = Object.fromEntries(Object.entries(vals).filter(([, v]) => v).map(([k, v]) => [k, minorToInput(int(v), cur)]))
  if (s.mode === 'itemized') {
    s.lines = (e.split?.items || []).map((i) => ({ id: lineId(), label: i.label || '', amount: minorToInput(int(i.minor), cur), among: [...i.among] }))
    s.tax = e.split?.tax ? minorToInput(int(e.split.tax), cur) : ''
    s.tip = e.split?.tip ? minorToInput(int(e.split.tip), cur) : ''
    s.discount = e.split?.discount ? minorToInput(int(e.split.discount), cur) : ''
  }
  if (e.payers && Object.keys(e.payers).length > 1) {
    s.severalPaid = true
    s.paid = Object.fromEntries(Object.entries(e.payers).map(([k, v]) => [k, minorToInput(int(v), cur)]))
  }
  return s
}

/* one line about whether the split adds up, and, for a receipt, the total that would make it */
export function verdict(s: SplitState, total: number, cur: string, result: SplitResult, unreadable: string | undefined, name: (u: string) => string): { text?: string; ok: boolean; fix?: number } {
  const m = (v: number) => money(toMajor(v, cur), cur)
  if (unreadable) {
    const what = ({ tax: 'The tax', tip: 'The tip', discount: 'The discount', item: "An item's amount" } as Record<string, string>)[unreadable] || `${name(unreadable)}'s figure`
    return { text: `${what} isn't a number.`, ok: false }
  }
  const items = s.lines.reduce((t, l) => t + (read(l.amount, cur) || 0), 0)
  const extras = (read(s.tax, cur) || 0) + (read(s.tip, cur) || 0) - (read(s.discount, cur) || 0)
  if (total <= 0) {
    if (s.mode === 'itemized' && items + extras > 0) return { text: "Enter the total, or use the receipt's.", ok: false, fix: items + extras }
    return { ok: false }
  }
  if (result.ok) {
    if (s.mode === 'exact') return { text: `Adds up to ${m(total)}.`, ok: true }
    if (s.mode === 'percent') return { text: 'Adds up to 100 %.', ok: true }
    if (s.mode === 'itemized') return { text: `Items, tax and tip come to ${m(total)}.`, ok: true }
    return { ok: true }
  }
  const e = result.error
  switch (e.code) {
    case 'empty':
      return { ok: false, text: s.mode === 'equal' || s.mode === 'adjust' ? 'Tick at least one person.' : s.mode === 'exact' ? 'Type what each person owes.' : s.mode === 'percent' ? 'Give each person a percentage.' : s.mode === 'shares' ? 'Give at least one person a share.' : s.lines.length ? 'Tick who had each item.' : 'Add at least one item.' }
    case 'sum_mismatch':
      if (s.mode === 'itemized') return { ok: false, text: `The receipt comes to ${m(total + e.diff)}, not ${m(total)}.`, fix: total + e.diff }
      return { ok: false, text: e.diff < 0 ? `${m(-e.diff)} of ${m(total)} still to assign.` : `${m(e.diff)} more than the total.` }
    case 'percent_total': {
      const pct = minorToInput(Math.abs(e.diff), 'EUR').replace(/,00$/, '')
      return { ok: false, text: e.diff < 0 ? `${pct} % still to assign.` : `${pct} % too much.` }
    }
    case 'remainder_negative': return { ok: false, text: `The adjustments are ${m(e.diff)} more than the total.` }
    case 'bad_value':
      return { ok: false, text: s.mode === 'percent' ? 'Percentages go from 0 to 100.' : s.mode === 'shares' ? 'Shares are numbers like 1, 2 or 1,5.' : e.who ? `Check ${name(e.who)}'s amount.` : 'Check the amounts.' }
    case 'not_in_split': return { ok: false, text: `Tick ${name(e.who)} to give them an adjustment.` }
    case 'too_large': return { ok: false, text: 'That amount is too large.' }
    default: return { ok: false, text: "This app can't edit that kind of split." }
  }
}

type Person = { id: string; name: string }

const small: CSSProperties = { width: 96, textAlign: 'right', padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }

function Status({ T, v, cur, setTotal }: { T: Theme; v: { text?: string; ok: boolean; fix?: number }; cur: string; setTotal: (minor: number) => void }) {
  if (!v.text && v.fix == null) return null
  return (
    <div style={{ margin: '8px 4px 0', fontSize: 13, lineHeight: 1.45 }}>
      {v.text && <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: v.ok ? T.green : T.red }}>{v.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{v.text}</div>}
      {v.fix != null && <button type="button" className="h-link" style={{ fontSize: 13, marginTop: 4 }} onClick={() => setTotal(v.fix!)}>Make the total {money(toMajor(v.fix, cur), cur)}</button>}
    </div>
  )
}

export function SplitEditor({ T, s, set, people, total, cur, seed, result, unreadable, name, setTotal }: {
  T: Theme; s: SplitState; set: (s: SplitState) => void; people: Person[]; total: number; cur: string; seed: string
  result: SplitResult; unreadable?: string; name: (u: string) => string; setTotal: (minor: number) => void
}) {
  const shares = result.ok ? result.shares : new Map<string, number>()
  const m = (v: number) => money(toMajor(v, cur), cur)
  const toggle = (u: string) => set({ ...s, among: s.among.includes(u) ? s.among.filter((x) => x !== u) : [...s.among, u] })
  const field = (key: 'exact' | 'percent' | 'shares' | 'adjust', u: string, placeholder: string, suffix: string) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <input className="fld" style={small} inputMode={key === 'adjust' ? 'text' : 'decimal'} placeholder={placeholder} aria-label={`${name(u)} ${suffix}`}
        value={s[key][u] || ''} onChange={(e) => set({ ...s, [key]: { ...s[key], [u]: e.target.value } })} />
      <span style={{ fontSize: 13, color: T.txt3, minWidth: 30 }}>{suffix}</span>
    </span>
  )
  const v = verdict(s, total, cur, result, unreadable, name)
  const everyone = people.length > 0 && people.every((p) => s.among.includes(p.id))

  return (
    <>
      <Field T={T} label={`Split ${MODE_TITLE[s.mode]}`} hint={HINT[s.mode]}>
        <SegmentedControl T={T} label="How to split" options={MODES} value={s.mode} onChange={(mode) => set(startMode(s, mode, total, cur, seed))} />
      </Field>
      {s.mode !== 'itemized' ? (
        <Field T={T} label={s.mode === 'equal' || s.mode === 'adjust'
          ? <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>Between · {s.among.length}</span>
              <button type="button" className="h-link" style={{ fontSize: 13 }} onClick={() => set({ ...s, among: everyone ? [] : people.map((p) => p.id) })}>{everyone ? 'Nobody' : 'Everyone'}</button></span>
          : 'Each person'}>
          <div className="h-well">
            {people.map((p) => {
              const on = s.among.includes(p.id)
              const sub = s.mode === 'adjust' ? (on && shares.has(p.id) ? m(shares.get(p.id)!) : null)
                : (s.mode === 'percent' || s.mode === 'shares') && shares.has(p.id) ? m(shares.get(p.id)!) : null
              const clickable = s.mode === 'equal'
              const Tag = clickable ? 'button' : 'div'
              return (
                <Tag key={p.id} type={clickable ? 'button' : undefined} className="h-item" aria-pressed={clickable ? on : undefined} onClick={clickable ? () => toggle(p.id) : undefined} style={{ '--inset': '58px', minHeight: 52 } as CSSProperties}>
                  <Avatar name={p.name} seed={p.id} size={30} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 500 }}>{name(p.id)}</span>
                    {sub && <span style={{ display: 'block', fontSize: 12, color: T.txt3, fontVariantNumeric: 'tabular-nums' }}>{sub}</span>}
                  </span>
                  {s.mode === 'equal' && <>
                    <span style={{ fontSize: 14, fontWeight: 650, color: on ? T.txt : T.txt3, fontVariantNumeric: 'tabular-nums' }}>{on ? m(shares.get(p.id) ?? 0) : 'not in'}</span>
                    <CheckCircle on={on} />
                  </>}
                  {s.mode === 'adjust' && <>
                    {on && field('adjust', p.id, '+0', cur)}
                    <button type="button" aria-label={on ? `Take ${name(p.id)} out` : `Put ${name(p.id)} in`} onClick={() => toggle(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><CheckCircle on={on} /></button>
                  </>}
                  {s.mode === 'exact' && field('exact', p.id, '0,00', cur)}
                  {s.mode === 'percent' && field('percent', p.id, '0', '%')}
                  {s.mode === 'shares' && field('shares', p.id, '0', '×')}
                </Tag>
              )
            })}
          </div>
          <Status T={T} v={v} cur={cur} setTotal={setTotal} />
        </Field>
      ) : (
        <>
          {s.lines.map((l, i) => (
            <div key={l.id} className="h-well" style={{ padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="fld" style={{ flex: 1 }} placeholder="Item, e.g. Pizza" aria-label={`Item ${i + 1}`} value={l.label}
                  onChange={(e) => set({ ...s, lines: s.lines.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) })} />
                <input className="fld" style={small} inputMode="decimal" placeholder="0,00" aria-label={`Item ${i + 1} amount`} value={l.amount}
                  onChange={(e) => set({ ...s, lines: s.lines.map((x) => (x.id === l.id ? { ...x, amount: e.target.value } : x)) })} />
                {s.lines.length > 1 && <button type="button" aria-label="Remove item" onClick={() => set({ ...s, lines: s.lines.filter((x) => x.id !== l.id) })} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}><Trash2 size={17} /></button>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {people.map((p) => {
                  const on = l.among.includes(p.id)
                  return <button key={p.id} type="button" className="chip" aria-pressed={on} onClick={() => set({ ...s, lines: s.lines.map((x) => (x.id === l.id ? { ...x, among: on ? x.among.filter((u) => u !== p.id) : [...x.among, p.id] } : x)) })}
                    style={on ? { background: T.acc, color: T.onAcc, borderColor: 'transparent' } : undefined}>{name(p.id)}</button>
                })}
              </div>
            </div>
          ))}
          <button type="button" className="h-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, margin: '0 4px 14px' }}
            onClick={() => set({ ...s, lines: [...s.lines, { id: lineId(), label: '', amount: '', among: people.map((p) => p.id) }] })}><Plus size={16} /> Add item</button>
          <Field T={T} label="Shared in proportion">
            <div className="h-well">
              {([['tax', 'Tax'], ['tip', 'Tip'], ['discount', 'Discount']] as const).map(([k, label]) => (
                <div key={k} className="h-item" style={{ minHeight: 50 }}>
                  <span style={{ flex: 1 }}>{label}</span>
                  <input className="fld" style={small} inputMode="decimal" placeholder="0,00" aria-label={label} value={s[k]} onChange={(e) => set({ ...s, [k]: e.target.value })} />
                  <span style={{ fontSize: 13, color: T.txt3, minWidth: 30 }}>{cur}</span>
                </div>
              ))}
            </div>
            <Status T={T} v={v} cur={cur} setTotal={setTotal} />
          </Field>
          {shares.size > 0 && (
            <Field T={T} label="Each person">
              <div className="h-well">
                {people.filter((p) => shares.has(p.id)).map((p) => (
                  <div key={p.id} className="h-item" style={{ '--inset': '58px' } as CSSProperties}>
                    <Avatar name={p.name} seed={p.id} size={30} /><span style={{ flex: 1 }}>{name(p.id)}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: T.txt2 }}>{m(shares.get(p.id)!)}</span>
                  </div>
                ))}
              </div>
            </Field>
          )}
        </>
      )}
    </>
  )
}

/* "Paid by several people": what each of them put down, and whether it adds up to the bill */
export function PayersEditor({ T, s, set, people, total, cur, name }: {
  T: Theme; s: SplitState; set: (s: SplitState) => void; people: Person[]; total: number; cur: string; name: (u: string) => string
}) {
  const paid = payersOf(s, cur)
  const sum = paid ? Object.values(paid).reduce((a, b) => a + b, 0) : 0
  const m = (v: number) => money(toMajor(v, cur), cur)
  const msg = paid == null ? { t: "One of the amounts isn't a number.", ok: false }
    : total > 0 && sum === total ? { t: `Adds up to ${m(total)}.`, ok: true }
    : total > 0 ? { t: sum < total ? `${m(total - sum)} of ${m(total)} still to assign.` : `${m(sum - total)} more than the total.`, ok: false } : null
  return (
    <Field T={T} label="Who paid">
      <div className="h-well">
        {people.map((p) => (
          <div key={p.id} className="h-item" style={{ '--inset': '58px', minHeight: 52 } as CSSProperties}>
            <Avatar name={p.name} seed={p.id} size={30} /><span style={{ flex: 1 }}>{name(p.id)}</span>
            <input className="fld" style={small} inputMode="decimal" placeholder="0,00" aria-label={`${name(p.id)} paid`} value={s.paid[p.id] || ''}
              onChange={(e) => set({ ...s, paid: { ...s.paid, [p.id]: e.target.value } })} />
            <span style={{ fontSize: 13, color: T.txt3, minWidth: 30 }}>{cur}</span>
          </div>
        ))}
      </div>
      {msg && <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '8px 4px 0', fontSize: 13, color: msg.ok ? T.green : T.red }}>{msg.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{msg.t}</div>}
    </Field>
  )
}
