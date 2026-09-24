import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Settings2, Trash2 } from 'lucide-react'
import type { Theme, Member, Expense, Cat } from '../../lib/types'
import { iconOf } from '../../icons'
import { money, numVal, tod, relDay } from '../../lib/format'
import { Sheet, Field, Btn, Chip, Avatar, CheckCircle } from '../ui'

type ExpenseInput = { desc: string; amount: number; paidBy: string; among: string[]; category: string; spentOn: string }

export default function ExpenseModal({ open, onClose, T, members, uid, addExpense, updateExpense, editing, prefill, hostCur, homeCur, rate, flatName, cats, openCategories, onDelete }: {
  open: boolean; onClose: () => void; T: Theme; members: Member[]; uid: string | null
  addExpense: (x: ExpenseInput) => void
  updateExpense: (id: string, x: ExpenseInput) => void
  editing: Expense | null; prefill: { desc: string; category: string } | null
  hostCur: string; homeCur: string; rate: number; flatName?: string
  cats: Cat[]; openCategories: () => void; onDelete?: () => void
}) {
  const [desc, setDesc] = useState('')
  const [amt, setAmt] = useState('')
  const [payer, setPayer] = useState(uid || '')
  const [among, setAmong] = useState<string[]>(members.map((m) => m.user_id))
  const [c, setC] = useState('groceries')
  const [date, setDate] = useState(tod())
  useEffect(() => {
    if (!open) return
    if (editing) { setDesc(editing.description || ''); setAmt(String(editing.amount).replace('.', ',')); setPayer(editing.paid_by); setAmong(editing.split_among || []); setC(editing.category || 'other'); setDate(editing.spent_on || tod()) }
    else { setDesc(prefill ? prefill.desc : ''); setAmt(''); setPayer(uid || ''); setAmong(members.map((m) => m.user_id)); setC(prefill ? prefill.category : 'groceries'); setDate(tod()) }
  }, [open])
  // when the flat's members change while the sheet is open (after choosing a different flat), re-seed split & payer
  useEffect(() => { if (open && !editing) { setAmong(members.map((m) => m.user_id)); setPayer((p) => (members.some((m) => m.user_id === p) ? p : uid || '')) } }, [members])
  const v = numVal(amt)
  const valid = !!v && among.length > 0 && !!payer && /^\d{4}-\d{2}-\d{2}$/.test(date)
  const toggle = (id: string) => setAmong((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  const nm = (u: string) => (u === uid ? 'You' : (members.find((m) => m.user_id === u) || ({} as Member)).display_name || '?')
  const everyone = among.length === members.length
  const save = () => { if (!valid) return; const x = { desc: desc.trim(), amount: v, paidBy: payer, among, category: c, spentOn: date }; if (editing) updateExpense(editing.id, x); else addExpense(x); onClose() }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Edit expense' : 'New shared expense'} T={T}
      footer={<>
        <Btn full disabled={!valid} onClick={save}>{editing ? 'Save changes' : v ? `Add ${money(v, hostCur)}` : 'Add expense'}</Btn>
        {editing && onDelete && <Btn full kind="danger" size="md" icon={Trash2} onClick={onDelete} style={{ marginTop: 4 }}>Delete expense</Btn>}
      </>}>
      {flatName && <div style={{ fontSize: 13.5, color: T.txt2, marginBottom: 14, marginTop: -4 }}>{editing ? 'In' : 'Adding to'} <b style={{ color: T.acc }}>{flatName}</b></div>}
      <Field T={T} label="How much?" htmlFor="ex-amt" hint={homeCur !== hostCur && v > 0 ? `≈ ${money(v * rate, homeCur)} in your home currency` : undefined}>
        <div style={{ position: 'relative' }}>
          <input id="ex-amt" className="fld fld-big" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="0,00" style={{ paddingRight: 64 }} />
          <span style={{ position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: T.txt3 }}>{hostCur}</span>
        </div>
      </Field>
      <Field T={T} label="What for?" htmlFor="ex-desc"><input id="ex-desc" className="fld" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Rewe groceries" /></Field>
      <Field T={T} label="Category">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {cats.map((x) => <Chip key={x.id} T={T} on={c === x.id} tint={x.color} icon={iconOf(x)} onClick={() => setC(x.id)}>{x.label}</Chip>)}
          <Chip T={T} dashed icon={Settings2} onClick={openCategories}>Edit</Chip>
        </div>
      </Field>
      <Field T={T} label="Paid by">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {members.map((m) => (
            <Chip key={m.user_id} T={T} on={payer === m.user_id} onClick={() => setPayer(m.user_id)} style={{ paddingLeft: 5 }}>
              <Avatar name={m.display_name} seed={m.user_id} size={24} /> {nm(m.user_id)}
            </Chip>
          ))}
        </div>
      </Field>
      <Field T={T} label={
        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Split between · {among.length}</span>
          <button type="button" className="h-link" style={{ fontSize: 13 }} onClick={() => setAmong(everyone && uid ? [uid] : members.map((m) => m.user_id))}>{everyone ? 'Just me' : 'Everyone'}</button>
        </span>
      }>
        <div className="h-well">
          {members.map((m) => {
            const on = among.includes(m.user_id)
            return (
              <button key={m.user_id} type="button" className="h-item" aria-pressed={on} onClick={() => toggle(m.user_id)} style={{ '--inset': '58px', minHeight: 52 } as CSSProperties}>
                <Avatar name={m.display_name} seed={m.user_id} size={30} />
                <span style={{ flex: 1, fontWeight: 500 }}>{nm(m.user_id)}</span>
                <span style={{ fontSize: 14, fontWeight: 650, color: on ? T.txt : T.txt3, fontVariantNumeric: 'tabular-nums' }}>{on ? money(v / Math.max(among.length, 1), hostCur) : 'not in'}</span>
                <CheckCircle on={on} />
              </button>
            )
          })}
        </div>
      </Field>
      <Field T={T} label="Date" htmlFor="ex-date" hint={date && date !== tod() ? relDay(date) : undefined} style={{ marginBottom: 4 }}>
        <input id="ex-date" className="fld" value={date} onChange={(e) => setDate(e.target.value)} type="date" />
      </Field>
    </Sheet>
  )
}
