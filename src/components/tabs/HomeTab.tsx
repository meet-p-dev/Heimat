import { ChevronRight } from 'lucide-react'
import type { Theme, Flat, Runway, Expense, ModalId, TabId } from '../../lib/types'
import type { RunwayCalc } from '../../lib/derive'
import { cat } from '../../lib/data'
import { CAT_ICON } from '../../icons'
import { Ring } from '../ui'

export default function HomeTab({ T, flat, myNet, runwayCalc, runway, fH, fHome, setModal, setTab, expenses, nameOf, startAddExpense }: {
  T: Theme; flat: Flat; myNet: number; runwayCalc: RunwayCalc | null; runway: Runway | null
  fH: (v: number) => string; fHome: (v: number) => string | null
  setModal: (m: ModalId) => void; setTab: (t: TabId) => void
  expenses: Expense[]; nameOf: (u: string) => string; startAddExpense: () => void
}) {
  return (
    <>
      <div style={{ textAlign: 'center', padding: '10px 0 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: T.txt3, textTransform: 'uppercase' }}>Your balance in {flat.name}</div>
        <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1.2, marginTop: 2, color: myNet > 0.5 ? T.green : myNet < -0.5 ? T.red : T.txt }}>{myNet >= 0 ? '+' : '−'}{fH(Math.abs(myNet))}</div>
        <div style={{ fontSize: 13, color: T.txt2, marginTop: 3 }}>{myNet > 0.5 ? 'you are owed' : myNet < -0.5 ? 'you owe' : 'all settled up'}{fHome(Math.abs(myNet)) ? ` · ${fHome(Math.abs(myNet))}` : ''}</div>
      </div>
      {runwayCalc && (
        <div onClick={() => setTab('money')} className="h-press" style={{ display: 'flex', alignItems: 'center', gap: 14, background: T.card, borderRadius: 20, padding: '15px 16px', marginBottom: 12, cursor: 'pointer' }}>
          <Ring pct={runwayCalc.monthsLeft / ((runway && runway.targetMonths) || 12)} size={64} stroke={7} color={runwayCalc.monthsLeft < 2 ? T.red : T.acc} track={T.border}><span style={{ fontSize: 15, fontWeight: 800 }}>{Math.floor(runwayCalc.monthsLeft)}</span><span style={{ fontSize: 8, color: T.txt2 }}>mo</span></Ring>
          <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: T.txt2 }}>Funds runway</div><div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4 }}>{fH(runwayCalc.left)} <span style={{ fontSize: 12, fontWeight: 500, color: T.txt3 }}>left</span></div><div style={{ fontSize: 11, color: T.txt3, marginTop: 1 }}>≈ {runwayCalc.monthsLeft.toFixed(1)} months</div></div>
          <ChevronRight size={18} color={T.txt3} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button onClick={startAddExpense} className="h-press" style={{ flex: 1, background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>+ Shared expense</button>
        <button onClick={() => setTab('flat')} className="h-press" style={{ flex: 1, background: T.card, color: T.txt, border: `1px solid ${T.border}`, borderRadius: 16, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Who owes whom</button>
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>Recent in your flat</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden' }}>
        {expenses.length === 0 ? (
          <div style={{ padding: '16px', color: T.txt3, fontSize: 14 }}>No shared expenses yet.</div>
        ) : (
          expenses.slice(0, 6).map((e, i) => {
            const c = cat(e.category)
            const CIcon = CAT_ICON[e.category] || CAT_ICON.other
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 15px', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: T.cardH, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.txt2 }}><CIcon size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{e.description || c.label}</div><div style={{ fontSize: 11, color: T.txt2 }}>{nameOf(e.paid_by)} paid · {e.spent_on}</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontSize: 14 }}>{fH(e.amount)}</div>{fHome(e.amount) && <div style={{ fontSize: 10, color: T.txt3 }}>{fHome(e.amount)}</div>}</div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
