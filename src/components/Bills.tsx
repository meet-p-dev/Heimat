import { useState, useEffect } from 'react'
import { Check, PlusCircle, FileText, ChevronRight } from 'lucide-react'
import type { Theme, Member } from '../lib/types'
import { isPending } from '../lib/types'
import type { Bill, BillStatus, BillRow } from '../lib/bills'
import { CADENCES, billsIn, billLine, cancelSoon, cancelByOf, nextBill } from '../lib/bills'
import { money, amountVal, relDay, tod } from '../lib/format'
import { haptic } from '../lib/haptic'
import { Sheet, Field, Btn, Card, Toggle, Stepper, SegmentedControl, Alert, TINT } from './ui'

/* Bills (docs/bills-screens.md; iOS: BillsViews.swift). */

export interface BillsCtx {
  T: Theme; uid: string | null; hostCur: string
  bills: Bill[]; status: Record<string, BillStatus>; members: Member[]
  who: (uid: string) => string
  edit: (b: Bill | null, flatId: string | null) => void
  tick: (b: Bill, due: string, paid: boolean) => Promise<void>
}

/* A group's bills (flatId) or your own (null): a row each with a tick circle, and Add bill. */
export function BillsSection({ b, flatId }: { b: BillsCtx; flatId: string | null }) {
  const { T } = b
  const list = billsIn(b.bills, b.status, flatId, b.uid)
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, margin: '0 4px 8px' }}>Bills</div>
      <div className="h-group">
        {list.map((x) => <BillRowView key={x.id} b={b} bill={x} />)}
        <button type="button" className="h-item" disabled={!b.uid} onClick={() => { haptic(8); b.edit(null, flatId) }} style={{ color: T.acc, fontWeight: 650 }}>
          <PlusCircle size={20} />
          <span style={{ flex: 1, textAlign: 'left' }}>{list.length ? 'Add bill' : flatId ? 'Add rent, electricity or internet' : 'Add your phone, insurance or gym'}</span>
        </button>
      </div>
    </div>
  )
}

function BillRowView({ b, bill }: { b: BillsCtx; bill: Bill }) {
  const { T } = b
  const [busy, setBusy] = useState(false)
  const s = b.status[bill.id]
  const line = billLine(bill, s, (u) => (u === b.uid ? 'you' : b.who(u)))
  const paid = s?.state === 'paid'
  const payer = bill.flat_id && bill.payer ? ` · ${bill.payer === b.uid ? 'you pay' : `${b.who(bill.payer)} pays`}` : ''
  const tick = async () => {
    if (!s || busy) return
    haptic(10); setBusy(true)
    // ticked: take back the latest tick; otherwise tick the date it is at
    if (paid && s.paid_on) await b.tick(bill, s.paid_on, false)
    else await b.tick(bill, s.due_on, true)
    setBusy(false)
  }
  return (
    <div className="h-item" style={{ '--inset': '58px' } as React.CSSProperties}>
      <button type="button" onClick={tick} aria-label={paid ? 'Paid — tap to undo' : `Mark ${bill.name} as paid`} disabled={busy}
        style={{ width: 28, height: 28, borderRadius: 99, flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1,
          background: paid ? T.green : 'transparent', border: paid ? 'none' : `2px solid ${line.urgent ? T.amber : T.border}`, color: '#fff' }}>
        {paid && <Check size={16} strokeWidth={3} />}
      </button>
      <button type="button" onClick={() => { haptic(8); b.edit(bill, bill.flat_id) }}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, color: T.txt, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.name}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: line.urgent ? T.amber : T.txt3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.text + payer}</span>
          {cancelSoon(s) && <span style={{ display: 'block', fontSize: 12, color: T.amber, marginTop: 2 }}>Cancel by {relDay(s!.cancel_by!)} if you want to end it</span>}
        </span>
        {bill.amount != null && <span style={{ fontSize: 15, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{money(bill.amount, bill.currency)}</span>}
      </button>
    </div>
  )
}

/* the line on a group's card: the bill that needs someone soonest */
export function NextBillLine({ b, flatId }: { b: BillsCtx; flatId: string }) {
  const n = nextBill(b.bills, b.status, flatId, b.uid)
  if (!n || b.status[n.id].state === 'paid') return null
  const line = billLine(n, b.status[n.id], (u) => (u === b.uid ? 'you' : b.who(u)))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12.5, fontWeight: 550, color: line.urgent ? b.T.amber : b.T.txt3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <FileText size={13} style={{ flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name}: {line.text}</span>
    </div>
  )
}

/* the Groups tab's card for your own bills */
export function MyBillsCard({ b, open }: { b: BillsCtx; open: () => void }) {
  const { T } = b
  const list = billsIn(b.bills, b.status, null, b.uid)
  const n = nextBill(b.bills, b.status, null, b.uid)
  const line = n ? billLine(n, b.status[n.id], () => 'you') : null
  return (
    <Card T={T} onClick={() => { haptic(8); open() }} ariaLabel="Open My bills" style={{ padding: 16, borderRadius: 24, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="h-item-ic" style={{ background: TINT.blue, width: 36, height: 36, borderRadius: 11 }}><FileText size={17} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 19, fontWeight: 800, letterSpacing: -0.4 }}>My bills</span>
        <span style={{ display: 'block', fontSize: 13, color: line?.urgent ? T.amber : T.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {n && line ? `${n.name}: ${line.text}` : list.length ? 'All paid' : 'Phone, insurance, gym — only you see these'}
        </span>
      </span>
      <ChevronRight size={18} color={T.txt3} />
    </Card>
  )
}

/* Add or edit a bill. In a group it asks who pays (and is reminded); your own are yours. */
export function BillModal({ b, open, onClose, editing, flatId, save, remove }: {
  b: BillsCtx; open: boolean; onClose: () => void; editing: Bill | null; flatId: string | null
  save: (id: string | null, row: BillRow) => Promise<string | null>; remove: (bill: Bill) => void
}) {
  const { T } = b
  const [name, setName] = useState('')
  const [amt, setAmt] = useState('')
  const [cadence, setCadence] = useState('monthly')
  const [first, setFirst] = useState(tod())
  const [payer, setPayer] = useState('')
  const [contract, setContract] = useState(false)
  const [ends, setEnds] = useState('')
  const [notice, setNotice] = useState(1)
  const [unit, setUnit] = useState<'month' | 'week'>('month')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cur = editing?.currency || b.hostCur
  const people = flatId ? b.members.filter((m) => m.flat_id === flatId && !m.left_at && !isPending(m)) : []

  useEffect(() => {
    if (!open) return
    setErr(null); setBusy(false)
    const e = editing
    setName(e?.name || ''); setAmt(e?.amount != null ? String(e.amount).replace('.', ',') : ''); setCadence(e?.cadence || 'monthly')
    setFirst(e?.anchor_on || tod()); setPayer(e ? e.payer || '' : flatId ? b.uid || '' : '')
    setContract(!!e?.contract_ends_on); setEnds(e?.contract_ends_on || `${new Date().getFullYear() + 1}${tod().slice(4)}`)
    setNotice(e?.notice_amount || 1); setUnit(e?.notice_unit || 'month')
  }, [open])

  const ok = !!name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(first) && (!contract || /^\d{4}-\d{2}-\d{2}$/.test(ends)) && !busy && !!b.uid
  const submit = async () => {
    if (!ok) return
    setBusy(true); setErr(null)
    const e = await save(editing?.id || null, {
      flat_id: flatId, owner_id: flatId ? null : b.uid, name: name.trim(), amount: amt.trim() ? amountVal(amt, cur) : null,
      currency: cur, category: editing?.category || 'bills', cadence, anchor_on: first,
      payer: flatId ? payer || null : b.uid,
      contract_ends_on: contract ? ends : null, notice_amount: contract ? notice : null, notice_unit: contract ? unit : null,
    })
    setBusy(false)
    if (e) setErr(e); else onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit bill' : 'New bill'} T={T}
      footer={<>
        <Btn full disabled={!ok} busy={busy} onClick={submit}>Save</Btn>
        {editing && <Btn full kind="danger" size="md" onClick={() => { if (confirm(`Remove ${editing.name}? Its ticks go with it.`)) { remove(editing); onClose() } }} style={{ marginTop: 4 }}>Remove bill</Btn>}
      </>}>
      <Field T={T} label="Name" htmlFor="bill-name"><input id="bill-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder={flatId ? 'e.g. Rent' : 'e.g. Phone'} /></Field>
      <Field T={T} label="Amount" htmlFor="bill-amt" hint="Leave it empty if it changes every time.">
        <div style={{ position: 'relative' }}>
          <input id="bill-amt" className="fld" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="optional" style={{ paddingRight: 64 }} />
          <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: T.txt3 }}>{cur}</span>
        </div>
      </Field>
      <Field T={T} label="How often" htmlFor="bill-cad">
        <select id="bill-cad" className="fld" value={cadence} onChange={(e) => setCadence(e.target.value)}>{CADENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field T={T} label={editing ? 'First due' : 'Next due'} htmlFor="bill-first"><input id="bill-first" className="fld" type="date" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
      {flatId && (
        <Field T={T} label="Who pays" htmlFor="bill-payer" hint="Whoever pays gets a reminder on the day it's due. Everyone sees when it's ticked.">
          <select id="bill-payer" className="fld" value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">Nobody set</option>
            {people.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === b.uid ? 'You' : m.display_name}</option>)}
          </select>
        </Field>
      )}
      <div className="h-group" style={{ marginBottom: 8 }}>
        <div className="h-item"><span style={{ flex: 1 }}>It's a contract that renews itself</span><Toggle label="Contract" on={contract} onChange={setContract} /></div>
      </div>
      <div style={{ fontSize: 12.5, color: T.txt3, margin: '0 4px 16px' }}>{contract ? 'We remind you four weeks and one week before the last day to cancel.' : 'Internet, phone or gym contracts often renew unless you cancel in time.'}</div>
      {contract && (
        <>
          <Field T={T} label="Contract ends" htmlFor="bill-ends"><input id="bill-ends" className="fld" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
          <Field T={T} label="Notice period">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Stepper label="notice" value={notice} onChange={setNotice} min={1} max={24} />
              <div style={{ flex: 1 }}><SegmentedControl T={T} label="Notice in" options={[['month', 'Months'], ['week', 'Weeks']]} value={unit} onChange={setUnit} /></div>
            </div>
          </Field>
          {/^\d{4}-\d{2}-\d{2}$/.test(ends) && <div style={{ fontSize: 14, fontWeight: 650, margin: '0 4px 16px' }}>Cancel by {new Date(cancelByOf(ends, notice, unit) + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
        </>
      )}
      {err && <Alert T={T}>{err}</Alert>}
    </Sheet>
  )
}
