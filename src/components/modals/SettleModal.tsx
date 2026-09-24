import { useState, useEffect } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import type { Theme, Member } from '../../lib/types'
import { settleSuggestions } from '../../lib/derive'
import { Sheet, Field, Btn, Chip, Avatar } from '../ui'
import { numVal } from '../../lib/format'

export default function SettleModal({ open, onClose, T, members, balances, uid, nameOf, fH, settleUp, initial }: {
  open: boolean; onClose: () => void; T: Theme; members: Member[]; balances: Record<string, number>
  uid: string | null; nameOf: (u: string) => string; fH: (v: number) => string
  settleUp: (from: string, to: string, amount: number) => void
  initial: { from: string; to: string; amount: number } | null
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amt, setAmt] = useState('')
  const suggestions = settleSuggestions(balances)
  const fill = (s: { from: string; to: string; amount: number }) => { setFrom(s.from); setTo(s.to); setAmt(s.amount.toFixed(2).replace('.', ',')) }
  useEffect(() => {
    if (!open) return
    const mine = suggestions.find((s) => s.from === uid || s.to === uid)
    if (initial) fill(initial)
    else if (mine || suggestions[0]) fill(mine || suggestions[0])
    else { setFrom(uid || ''); setTo(members.find((m) => m.user_id !== uid)?.user_id || ''); setAmt('') }
  }, [open])
  const v = numVal(amt)
  const valid = v > 0 && !!from && !!to && from !== to

  const picker = (value: string, set: (u: string) => void, exclude?: string) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
      {members.filter((m) => m.user_id !== exclude).map((m) => (
        <Chip key={m.user_id} T={T} on={value === m.user_id} onClick={() => set(m.user_id)} style={{ paddingLeft: 5 }}><Avatar name={m.display_name} seed={m.user_id} size={24} /> {nameOf(m.user_id)}</Chip>
      ))}
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} title="Settle up" T={T}
      footer={<Btn full disabled={!valid} onClick={() => { if (!valid) return; settleUp(from, to, v); onClose() }}>{valid ? `Record ${fH(v)} payment` : 'Record payment'}</Btn>}>
      {suggestions.length > 0 && (
        <Field T={T} label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={13} /> Suggested</span>} hint="The fewest payments that square everyone up. Tap one to fill it in.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {suggestions.map((s) => {
              const on = s.from === from && s.to === to
              return (
                <button key={s.from + s.to} type="button" className="h-well" onClick={() => fill(s)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', cursor: 'pointer', color: T.txt, borderColor: on ? T.acc : undefined, textAlign: 'left' }}>
                  <span style={{ fontWeight: 600 }}>{nameOf(s.from)}</span><ArrowRight size={15} color={T.txt3} /><span style={{ fontWeight: 600, flex: 1 }}>{nameOf(s.to)}</span>
                  <span style={{ fontWeight: 750, color: T.acc, fontVariantNumeric: 'tabular-nums' }}>{fH(s.amount)}</span>
                </button>
              )
            })}
          </div>
        </Field>
      )}
      <Field T={T} label="Who paid">{picker(from, (u) => { setFrom(u); if (u === to) setTo('') })}</Field>
      <Field T={T} label="Paid to" error={from && from === to ? 'Pick two different people.' : undefined}>{picker(to, setTo, from)}</Field>
      <Field T={T} label="Amount" htmlFor="st-amt" style={{ marginBottom: 4 }}><input id="st-amt" className="fld fld-big" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0,00" /></Field>
    </Sheet>
  )
}
