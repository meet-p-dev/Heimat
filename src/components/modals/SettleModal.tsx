import { useState, useEffect } from 'react'
import type { Theme, Member } from '../../lib/types'
import { Sheet, Field, inpStyle } from '../ui'

export default function SettleModal({ open, onClose, T, members, balances, uid, nameOf, fH, settleUp }: {
  open: boolean; onClose: () => void; T: Theme; members: Member[]; balances: Record<string, number>
  uid: string | null; nameOf: (u: string) => string; fH: (v: number) => string
  settleUp: (from: string, to: string, amount: number) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amt, setAmt] = useState('')
  useEffect(() => {
    if (open) {
      const debtor = members.find((m) => (balances[m.user_id] || 0) < -0.5)
      const creditor = members.find((m) => (balances[m.user_id] || 0) > 0.5)
      setFrom(debtor ? debtor.user_id : uid || '')
      setTo(creditor ? creditor.user_id : '')
      setAmt('')
    }
  }, [open])
  return (
    <Sheet open={open} onClose={onClose} title="Settle up" T={T}>
      <Field label="Who pays" T={T}><select value={from} onChange={(e) => setFrom(e.target.value)} style={inpStyle(T)}>{members.map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(m.user_id)}</option>)}</select></Field>
      <Field label="Pays to" T={T}><select value={to} onChange={(e) => setTo(e.target.value)} style={inpStyle(T)}>{members.map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(m.user_id)}</option>)}</select></Field>
      <Field label="Amount" T={T}><input value={amt} onChange={(e) => setAmt(e.target.value)} type="number" inputMode="decimal" placeholder="0.00" style={inpStyle(T)} /></Field>
      <button onClick={() => { const v = parseFloat(amt) || 0; if (!v || from === to) return; settleUp(from, to, v); onClose() }} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>Record payment</button>
    </Sheet>
  )
}
