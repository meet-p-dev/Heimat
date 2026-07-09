import { useState, useEffect } from 'react'
import type { Theme, Member, Expense } from '../../lib/types'
import { CATS } from '../../lib/data'
import { CAT_ICON } from '../../icons'
import { money, numVal } from '../../lib/format'
import { Sheet, Field, inpStyle } from '../ui'

export default function ExpenseModal({ open, onClose, T, members, uid, addExpense, updateExpense, editing, hostCur, homeCur, rate, flatName }: {
  open: boolean; onClose: () => void; T: Theme; members: Member[]; uid: string | null
  addExpense: (x: { desc: string; amount: number; paidBy: string; among: string[]; category: string }) => void
  updateExpense: (id: string, x: { desc: string; amount: number; paidBy: string; among: string[]; category: string }) => void
  editing: Expense | null; hostCur: string; homeCur: string; rate: number; flatName?: string
}) {
  const [desc, setDesc] = useState('')
  const [amt, setAmt] = useState('')
  const [payer, setPayer] = useState(uid || '')
  const [among, setAmong] = useState<string[]>(members.map((m) => m.user_id))
  const [c, setC] = useState('groceries')
  useEffect(() => {
    if (!open) return
    if (editing) { setDesc(editing.description || ''); setAmt(String(editing.amount).replace('.', ',')); setPayer(editing.paid_by); setAmong(editing.split_among || []); setC(editing.category || 'other') }
    else { setDesc(''); setAmt(''); setPayer(uid || ''); setAmong(members.map((m) => m.user_id)); setC('groceries') }
  }, [open])
  // when the flat's members change while the sheet is open (after choosing a different flat), re-seed split & payer
  useEffect(() => { if (open && !editing) { setAmong(members.map((m) => m.user_id)); setPayer((p) => (members.some((m) => m.user_id === p) ? p : uid || '')) } }, [members])
  const v = numVal(amt)
  const toggle = (id: string) => setAmong((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  const nm = (u: string) => (u === uid ? 'You' : (members.find((m) => m.user_id === u) || ({} as Member)).display_name || '?')
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit expense' : 'Shared expense'} T={T}>
      {flatName && <div style={{ fontSize: 12, color: T.txt2, marginBottom: 12, marginTop: -4 }}>{editing ? 'Editing in' : 'Adding to'} <span style={{ fontWeight: 700, color: T.acc }}>{flatName}</span></div>}
      <Field label="What for?" T={T}><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Rewe groceries" style={inpStyle(T)} /></Field>
      <Field label={`Amount (${hostCur})`} T={T}><input value={amt} onChange={(e) => setAmt(e.target.value)} type="text" inputMode="decimal" placeholder="0,00" style={{ ...inpStyle(T), fontSize: 22, fontWeight: 700 }} />{homeCur !== hostCur && v > 0 && <div style={{ fontSize: 12, color: T.txt3, marginTop: 6 }}>≈ {money(v * rate, homeCur)} in your currency</div>}</Field>
      <Field label="Paid by" T={T}><select value={payer} onChange={(e) => setPayer(e.target.value)} style={inpStyle(T)}>{members.map((m) => <option key={m.user_id} value={m.user_id}>{nm(m.user_id)}</option>)}</select></Field>
      <Field label="Category" T={T}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{CATS.map((x) => {
          const XI = CAT_ICON[x.id]
          const on = c === x.id
          return <button key={x.id} onClick={() => setC(x.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: on ? T.acc : T.inp, color: on ? '#fff' : T.txt2, border: `1px solid ${on ? T.acc : T.border}`, borderRadius: 99, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}><XI size={14} /> {x.label}</button>
        })}</div>
      </Field>
      <Field label={`Split between (${among.length})`} T={T}>{members.map((m) => {
        const on = among.includes(m.user_id)
        return <div key={m.user_id} onClick={() => toggle(m.user_id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: T.inp, borderRadius: 12, marginBottom: 7, cursor: 'pointer', border: `1px solid ${on ? T.acc : T.border}` }}><span style={{ fontWeight: 500 }}>{nm(m.user_id)}</span><span style={{ color: on ? T.acc : T.txt3, fontWeight: 700 }}>{on ? `${money(v / Math.max(among.length, 1), hostCur)} ✓` : '—'}</span></div>
      })}</Field>
      <button onClick={() => { if (!v || among.length === 0 || !payer) return; const x = { desc: desc.trim(), amount: v, paidBy: payer, among, category: c }; if (editing) updateExpense(editing.id, x); else addExpense(x); onClose() }} disabled={!v || among.length === 0} className="h-press" style={{ width: '100%', background: v && among.length ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginBottom: 8 }}>{editing ? 'Save changes' : 'Add expense'}</button>
    </Sheet>
  )
}
