import { Plus, Clock, ShoppingCart, LineChart, Wallet, Users, ShieldAlert, ChevronRight, ArrowRightLeft, KeyRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Theme, Flat, Runway, Expense, Cat, ModalId, TabId, AuthMode } from '../../lib/types'
import type { RunwayCalc, WorkStats, SettleSuggestion } from '../../lib/derive'
import { Ring, Card, Btn, SectionLabel, AnimatedNumber, TINT } from '../ui'
import ExpenseRow from '../ExpenseRow'
import { fixDe } from '../../lib/format'
import { haptic } from '../../lib/haptic'
import { WORK } from '../../lib/theme'

function QuickAction({ icon: I, tint, label, onClick, badge }: { icon: LucideIcon; tint: string; label: string; onClick: () => void; badge?: number }) {
  return (
    <button type="button" className="glass h-qa" onClick={() => { haptic(8); onClick() }}>
      <span className="h-qa-ic" style={{ background: tint }}><I size={21} strokeWidth={2.2} />{badge ? <span className="h-badge">{badge}</span> : null}</span>
      <span>{label}</span>
    </button>
  )
}

export default function HomeTab({ T, flat, uid, isAnon, myNet, runwayCalc, runway, workStats: ws, fH, fHome, setModal, setTab, expenses, nameOf, startAddExpense, cats, openList, openCount, onLogShift, openSettle, onOpenExpense, onAuth }: {
  T: Theme; flat: Flat | null; uid: string | null; isAnon: boolean; myNet: number; runwayCalc: RunwayCalc | null; runway: Runway | null; workStats: WorkStats
  fH: (v: number) => string; fHome: (v: number) => string | null
  setModal: (m: ModalId) => void; setTab: (t: TabId) => void
  expenses: Expense[]; nameOf: (u: string) => string; startAddExpense: () => void; cats: Cat[]
  openList: () => void; openCount: number; onLogShift: () => void; openSettle: (s: SettleSuggestion | null) => void
  onOpenExpense: (e: Expense) => void; onAuth: (m: AuthMode) => void
}) {
  const tone = myNet > 0.5 ? T.green : myNet < -0.5 ? T.red : T.txt
  const status = myNet > 0.5 ? 'you are owed' : myNet < -0.5 ? 'you owe' : 'all settled up'
  const home = fHome(Math.abs(myNet))
  const toneC = ws.tone === 'red' ? T.red : ws.tone === 'amber' ? T.amber : WORK

  const actions = flat
    ? [
        { icon: Plus, tint: TINT.green, label: 'Expense', onClick: startAddExpense },
        { icon: Clock, tint: TINT.orange, label: 'Log shift', onClick: onLogShift },
        { icon: ShoppingCart, tint: TINT.pink, label: 'List', onClick: openList, badge: openCount },
        { icon: LineChart, tint: TINT.blue, label: 'Analytics', onClick: () => setModal('analytics') },
      ]
    : [
        { icon: Clock, tint: TINT.orange, label: 'Log shift', onClick: onLogShift },
        { icon: Wallet, tint: TINT.blue, label: 'Runway', onClick: () => setModal('runway') },
      ]

  return (
    <>
      {flat ? (
        <Card T={T} grad style={{ padding: '20px 18px 18px', borderRadius: 28, marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: T.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Your balance · {flat.name}</div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.8, margin: '4px 0 0', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: tone }}>
            {myNet < -0.5 ? '−' : myNet > 0.5 ? '+' : ''}<AnimatedNumber value={Math.abs(myNet)} format={fH} />
          </div>
          <div style={{ fontSize: 14, color: T.txt2, marginTop: 4 }}>{status}{home && Math.abs(myNet) > 0.5 ? ` · ≈ ${home}` : ''}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn size="md" icon={Plus} onClick={startAddExpense} style={{ flex: 1 }}>Add expense</Btn>
            <Btn size="md" kind="secondary" icon={ArrowRightLeft} onClick={() => openSettle(null)} style={{ flex: 1 }}>Settle up</Btn>
          </div>
        </Card>
      ) : (
        <Card T={T} grad style={{ padding: '20px 18px 18px', borderRadius: 28, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span className="h-item-ic" style={{ background: TINT.green, width: 46, height: 46, borderRadius: 15 }}><Users size={23} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 750, fontSize: 18, letterSpacing: -0.3 }}>Share bills with flatmates</div>
              <div style={{ fontSize: 14, color: T.txt2, marginTop: 4, lineHeight: 1.5 }}>Create a flat and invite them with a code — or join theirs. Bills sync live between your phones.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn size="md" icon={Plus} disabled={!uid} onClick={() => setModal('create')} style={{ flex: 1 }}>Create flat</Btn>
            <Btn size="md" kind="secondary" icon={KeyRound} disabled={!uid} onClick={() => setModal('join')} style={{ flex: 1 }}>Join</Btn>
          </div>
          {isAnon && <div style={{ textAlign: 'center', fontSize: 13.5, color: T.txt2, marginTop: 14 }}>Been here before? <button type="button" className="h-link" onClick={() => onAuth('signin')}>Sign in</button></div>}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actions.length > 2 ? 4 : 2}, 1fr)`, gap: 10, marginBottom: 14 }}>
        {actions.map((a) => <QuickAction key={a.label} {...a} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card T={T} onClick={() => setTab('money')} ariaLabel="Funds runway" style={{ padding: 14, borderRadius: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, marginBottom: 10 }}>Funds runway</div>
          {runwayCalc ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Ring pct={runwayCalc.monthsLeft / ((runway && runway.targetMonths) || 12)} size={54} stroke={6} color={runwayCalc.monthsLeft < 2 ? T.red : T.acc} track={T.border}><span style={{ fontSize: 15, fontWeight: 800 }}>{Math.floor(runwayCalc.monthsLeft)}</span><span style={{ fontSize: 9, color: T.txt2 }}>mo</span></Ring>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fH(runwayCalc.left)}</div>
                <div style={{ fontSize: 12, color: T.txt3 }}>≈ {fixDe(runwayCalc.monthsLeft)} months</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>How long will your money last? <span style={{ color: T.acc }}>Set up</span></div>
          )}
        </Card>
        <Card T={T} onClick={() => setTab('work')} ariaLabel="Work limit" style={{ padding: 14, borderRadius: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, marginBottom: 10 }}>Work limit</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ring pct={ws.daysUsed / ws.budget} size={54} stroke={6} color={toneC} track={T.border}><span style={{ fontSize: 14, fontWeight: 800 }}>{fixDe(ws.daysUsed, ws.daysUsed % 1 ? 1 : 0)}</span><span style={{ fontSize: 9, color: T.txt2 }}>days</span></Ring>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>{fixDe(ws.weekH)} h</div>
              <div style={{ fontSize: 12, color: ws.weekH > ws.weekCap ? T.red : T.txt3, whiteSpace: 'nowrap' }}>of {ws.weekCap} h / week</div>
            </div>
          </div>
        </Card>
      </div>

      {flat && isAnon && (
        <Card T={T} onClick={() => onAuth('signup')} style={{ marginTop: 12, padding: '13px 14px', borderRadius: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="h-item-ic" style={{ background: TINT.orange }}><ShieldAlert size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 15 }}>Save your account</div>
            <div style={{ fontSize: 12.5, color: T.txt2, marginTop: 1 }}>As a guest, your place in the flat lives on this device only.</div>
          </div>
          <ChevronRight size={18} color={T.txt3} />
        </Card>
      )}

      {flat && (
        <>
          <SectionLabel T={T} right={expenses.length > 0 && <button type="button" className="h-link" style={{ fontSize: 13.5 }} onClick={() => setTab('flat')}>See all</button>}>Recent activity</SectionLabel>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
            {expenses.length === 0
              ? <div style={{ padding: 18, color: T.txt2, fontSize: 14, lineHeight: 1.5 }}>No shared expenses yet. Add the first one — rent, groceries, the internet bill — and Heimat splits it.</div>
              : expenses.slice(0, 5).map((e) => <ExpenseRow key={e.id} {...{ T, e, cats, uid, nameOf, fH }} onClick={() => onOpenExpense(e)} />)}
          </div>
        </>
      )}
    </>
  )
}
