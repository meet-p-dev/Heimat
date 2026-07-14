import type { Theme, Expense, Cat } from '../../lib/types'
import { catOf } from '../../lib/data'
import { iconOf } from '../../icons'
import { Sheet } from '../ui'

export default function ExpenseDetailModal({ open, onClose, T, expense, fH, nameOf, cats }: {
  open: boolean; onClose: () => void; T: Theme; expense: Expense | null
  fH: (v: number) => string; nameOf: (u: string) => string; cats: Cat[]
}) {
  if (!expense) return null
  const e = expense
  const c = catOf(cats, e.category)
  const CIcon = iconOf(c)
  const parts = e.split_among && e.split_among.length ? e.split_among : [e.paid_by]
  const share = e.amount / parts.length
  return (
    <Sheet open={open} onClose={onClose} title="Expense" T={T}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: T.inp, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.txt2 }}><CIcon size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{e.description || c.label}</div>
          <div style={{ fontSize: 12, color: T.txt2, marginTop: 2 }}>{c.label} · {e.spent_on}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{fH(e.amount)}</div>
      </div>
      <div style={{ background: T.inp, borderRadius: 14, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: T.txt2 }}>
        <span style={{ fontWeight: 700, color: T.txt }}>{nameOf(e.paid_by)}</span> paid · added by <span style={{ fontWeight: 700, color: T.txt }}>{nameOf(e.created_by)}</span>
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>Split between ({parts.length})</span>
      <div style={{ marginBottom: 8 }}>
        {parts.map((u) => (
          <div key={u} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: T.inp, borderRadius: 12, marginBottom: 7, border: `1px solid ${T.border}` }}>
            <span style={{ fontWeight: 500 }}>{nameOf(u)}</span>
            <span style={{ fontWeight: 700, color: T.acc, fontVariantNumeric: 'tabular-nums' }}>{fH(share)}</span>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
