import type { CSSProperties } from 'react'
import type { Theme, Expense, Cat } from '../lib/types'
import { catOf } from '../lib/data'
import { iconOf } from '../icons'
import { colorOf } from '../lib/theme'
import { relDay } from '../lib/format'
import { sharesOf, toMajor } from '../lib/ledger'

/* One shared expense, with what it means for you — "you owe €4,20" — right under
   the amount, the way people actually read a split bill. */
export default function ExpenseRow({ T, e, cats, uid, nameOf, fH, onClick }: {
  T: Theme; e: Expense; cats: Cat[]; uid: string | null; nameOf: (u: string) => string; fH: (v: number) => string; onClick: () => void
}) {
  const c = catOf(cats, e.category)
  const I = iconOf(c)
  const tint = colorOf(c)
  const shares = sharesOf(e)
  const mine = uid ? shares.find((s) => s.uid === uid) : undefined
  let note: { t: string; col: string } = { t: 'not involved', col: T.txt3 }
  if (uid && e.paid_by === uid) {
    // what everyone else owes you for it, to the cent
    const lent = shares.reduce((t, s) => t + (s.uid === uid ? 0 : s.minor), 0)
    note = lent > 0 ? { t: `you lent ${fH(toMajor(lent, e.currency))}`, col: T.green } : { t: 'just you', col: T.txt3 }
  } else if (mine) note = { t: `you owe ${fH(toMajor(mine.minor, e.currency))}`, col: T.red }

  return (
    <button type="button" className="h-item" onClick={onClick} style={{ '--inset': '69px' } as CSSProperties}>
      <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, background: `${tint}26`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><I size={19} strokeWidth={2.1} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.description || c.label}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: T.txt3, marginTop: 2 }}>{nameOf(e.paid_by)} paid · {relDay(e.spent_on)}</span>
      </span>
      <span style={{ textAlign: 'right', flexShrink: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{fH(e.amount)}</span>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: note.col, marginTop: 2 }}>{note.t}</span>
      </span>
    </button>
  )
}
