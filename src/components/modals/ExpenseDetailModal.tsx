import type { CSSProperties } from 'react'
import type { Theme, Expense, Cat } from '../../lib/types'
import { catOf } from '../../lib/data'
import { iconOf } from '../../icons'
import { colorOf } from '../../lib/theme'
import { relDay } from '../../lib/format'
import { Sheet, Avatar, SectionLabel } from '../ui'

export default function ExpenseDetailModal({ open, onClose, T, expense, fH, nameOf, cats }: {
  open: boolean; onClose: () => void; T: Theme; expense: Expense | null
  fH: (v: number) => string; nameOf: (u: string) => string; cats: Cat[]
}) {
  if (!expense) return null
  const e = expense
  const c = catOf(cats, e.category)
  const CIcon = iconOf(c)
  const tint = colorOf(c)
  const parts = e.split_among && e.split_among.length ? e.split_among : [e.paid_by]
  const share = e.amount / parts.length
  return (
    <Sheet open={open} onClose={onClose} title="Expense" T={T}>
      <div style={{ textAlign: 'center', padding: '4px 0 6px' }}>
        <div style={{ width: 58, height: 58, borderRadius: 19, background: `${tint}26`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><CIcon size={27} /></div>
        <div style={{ fontWeight: 750, fontSize: 19, marginTop: 12 }}>{e.description || c.label}</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1.2, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{fH(e.amount)}</div>
        <div style={{ fontSize: 13.5, color: T.txt2, marginTop: 4 }}>{c.label} · {relDay(e.spent_on)} · paid by <b style={{ color: T.txt }}>{nameOf(e.paid_by)}</b></div>
        <div style={{ fontSize: 12.5, color: T.txt3, marginTop: 4 }}>Added by {nameOf(e.created_by)} — only they or the payer can edit it</div>
      </div>
      <SectionLabel T={T}>Split between · {parts.length}</SectionLabel>
      <div className="h-well">
        {parts.map((u) => (
          <div key={u} className="h-item" style={{ '--inset': '58px', minHeight: 50 } as CSSProperties}>
            <Avatar name={nameOf(u)} seed={u} size={30} />
            <span style={{ flex: 1, fontWeight: 500 }}>{nameOf(u)}</span>
            <span style={{ fontWeight: 700, color: T.acc, fontVariantNumeric: 'tabular-nums' }}>{fH(share)}</span>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
