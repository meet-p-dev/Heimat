import { Plus, Download, Clock, ShoppingCart, LineChart, Wallet, Users, ShieldAlert, ChevronRight, ArrowRightLeft, KeyRound, Bell, Check, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Theme, Flat, Runway, Expense, Cat, ModalId, TabId, AuthMode } from '../../lib/types'
import type { RunwayCalc, WorkStats, SettleSuggestion } from '../../lib/derive'
import { useState } from 'react'
import { Ring, Card, Btn, SectionLabel, AnimatedNumber, SegmentedControl, TINT } from '../ui'
import ExpenseRow from '../ExpenseRow'
import { ActivityRow } from '../Activity'
import type { Activity } from '../../lib/activity'
import { LS } from '../../lib/storage'
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

export default function HomeTab({ T, show, flat, scope, hasMoney, start, uid, isAnon, myNet, runwayCalc, runway, workStats: ws, fH, fHome, setModal, setTab, nameOf, startAddExpense, cats, openList, openCount, onLogShift, openSettle, onOpenExpense, onAuth, pushAsk, pushBusy, onPushOn, onPushLater, mine, activity, placeName, mixed, curOf, onAllActivity, update, onUpdate }: {
  T: Theme; flat: Flat | null
  /* what the balance covers ("Across 2 groups and friends"), and whether there is any to show */
  scope: string; hasMoney: boolean
  /* for Get started: the setup answer and what has happened yet */
  /* loaded: your groups are known — until then no "Get started", which would be wrong for someone with groups */
  start: { share: string[]; hasExpense: boolean; hasShift: boolean; loaded?: boolean }
  /* the parts this person has switched on (src/lib/life.ts) */
  show: { work: boolean; list: boolean; limit: boolean; runway: boolean }
  uid: string | null; isAnon: boolean; myNet: number; runwayCalc: RunwayCalc | null; runway: Runway | null; workStats: WorkStats
  fH: (v: number) => string; fHome: (v: number) => string | null
  setModal: (m: ModalId) => void; setTab: (t: TabId) => void
  /* no longer used: Home lists your expenses across every group (`mine`) */
  expenses?: Expense[]; nameOf: (u: string) => string; startAddExpense: () => void; cats: Cat[]
  openList: () => void; openCount: number; onLogShift: () => void; openSettle: (s: SettleSuggestion | null) => void
  onOpenExpense: (e: Expense) => void; onAuth: (m: AuthMode) => void
  /* offer notifications (App.tsx decides when this device can and hasn't been asked) */
  pushAsk: boolean; pushBusy: boolean; onPushOn: () => void; onPushLater: () => void
  /* Activity: the expenses you are on across every group (newest first), or everything
     that happened; `mixed` when there is more than one place, so rows name theirs */
  mine: Expense[]; activity: Activity[]; placeName: (id: string) => string; mixed: boolean
  curOf: (place: string) => string; onAllActivity: () => void
  /* a newer Android version is out: one tap to its download (iOS: TestFlight) */
  update?: { build: number } | null; onUpdate?: () => void
}) {
  const [feed, setFeed] = useState<'mine' | 'all'>(() => (LS.g<string>('mt-h-home-activity') === 'all' ? 'all' : 'mine'))
  const pickFeed = (v: 'mine' | 'all') => { setFeed(v); LS.s('mt-h-home-activity', v) }
  const [startHidden, setStartHidden] = useState(() => LS.g<boolean>('mt-h-start-hidden') === true)
  const hideStart = () => { setStartHidden(true); LS.s('mt-h-start-hidden', true) }
  // the first things a new person does, from their setup answer, each ticked off by what
  // has actually happened (same steps as the iPhone app's HomeView)
  const g = start.share.includes('flatmates') ? ['Set up your flat', 'A group for your WG — invite your flatmates with a link.']
    : start.share.includes('partner') ? ['Start a group with your partner', 'Rent, groceries, trips — always even.']
    : start.share.includes('family') ? ['Make a family group', 'Share costs with family here or back home.']
    : start.share.includes('friends') ? ['Make a group with friends', 'For a trip or a flat — or split one bill from Groups.']
    : ['Make your first group', 'Or join one with the code a friend sent you.']
  const steps: Step[] = [
    { id: 'group', title: g[0], sub: g[1], Icon: Users, done: hasMoney, actions: [
      { label: 'New group', Icon: Plus, onClick: () => setModal('create') },
      { label: 'Join', Icon: KeyRound, kind: 'secondary', onClick: () => setModal('join') }] },
    { id: 'expense', title: 'Add your first expense', sub: 'Who paid, how much, and how to split it.', Icon: Plus, done: start.hasExpense,
      actions: [{ label: 'Add expense', Icon: Plus, onClick: startAddExpense }] },
    ...(show.work ? [{ id: 'shift', title: 'Log a shift', sub: 'Your pay this month, and an estimate of the tax.', Icon: Clock, done: start.hasShift,
      actions: [{ label: 'Log a shift', Icon: Clock, onClick: onLogShift }] }] : []),
    ...(isAnon ? [{ id: 'account', title: 'Save it with a free account', sub: 'So nothing is lost if you change phone.', Icon: ShieldCheck, done: false,
      actions: [{ label: 'Create free account', onClick: () => onAuth('signup') }] }] : []),
  ]
  // myNet is whole cents from the ledger, so exactly zero is settled — no ±0,50 € blind spot
  const tone = myNet > 0 ? T.green : myNet < 0 ? T.red : T.txt
  const status = myNet > 0 ? 'you are owed' : myNet < 0 ? 'you owe' : 'all settled up'
  const home = fHome(Math.abs(myNet))
  const toneC = ws.tone === 'red' ? T.red : ws.tone === 'amber' ? T.amber : WORK

  const shift = { icon: Clock, tint: TINT.orange, label: 'Log shift', onClick: onLogShift }
  // adding an expense is the card's big button, so it isn't repeated here
  const actions = [
    show.work && shift,
    flat && show.list && { icon: ShoppingCart, tint: TINT.pink, label: 'List', onClick: openList, badge: openCount },
    hasMoney && { icon: LineChart, tint: TINT.blue, label: 'My spending', onClick: () => setModal('myspend') },
    !flat && show.runway && { icon: Wallet, tint: TINT.blue, label: 'Runway', onClick: () => setModal('runway') },
  ].filter(Boolean) as { icon: typeof Clock; tint: string; label: string; onClick: () => void; badge?: number }[]

  return (
    <>
      {/* it stays until this phone runs that version */}
      {update && (
        <Card T={T} style={{ padding: 14, borderRadius: 22, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="h-item-ic" style={{ background: TINT.blue }}><Download size={17} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 650, fontSize: 15 }}>New update available</span>
            <span style={{ display: 'block', fontSize: 12.5, color: T.txt2, marginTop: 1 }}>Version {update.build} is ready to download.</span>
          </span>
          <Btn size="sm" onClick={() => { haptic(8); onUpdate?.() }}>Update</Btn>
        </Card>
      )}
      {hasMoney ? (
        <Card T={T} grad style={{ padding: '20px 18px 18px', borderRadius: 28, marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: T.txt2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scope}</div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: -1.8, margin: '4px 0 0', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: tone }}>
            {myNet < 0 ? '−' : myNet > 0 ? '+' : ''}<AnimatedNumber value={Math.abs(myNet)} format={fH} />
          </div>
          <div style={{ fontSize: 14, color: T.txt2, marginTop: 4 }}>{status}{home && myNet !== 0 ? ` · ≈ ${home}` : ''}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn size="md" icon={Plus} onClick={startAddExpense} style={{ flex: 1 }}>Add expense</Btn>
            <Btn size="md" kind="secondary" icon={ArrowRightLeft} onClick={() => openSettle(null)} style={{ flex: 1 }}>Settle up</Btn>
          </div>
        </Card>
      ) : null}
      {start.loaded !== false && (!hasMoney || (!startHidden && !steps.every((x) => x.done))) && (
        <GetStarted T={T} steps={steps} canHide={hasMoney} uid={uid} onHide={hideStart} showSignIn={isAnon && !hasMoney} onAuth={onAuth} />
      )}

      {actions.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${actions.length > 2 ? 4 : 2}, 1fr)`, gap: 10, marginBottom: 14 }}>
        {actions.map((a) => <QuickAction key={a.label} {...a} />)}
      </div>}

      {/* only once there's someone to hear from: a group, or expenses with friends */}
      {hasMoney && pushAsk && (
        <Card T={T} style={{ padding: '15px 14px 14px', borderRadius: 24, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="h-item-ic" style={{ background: TINT.red }}><Bell size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>Know when someone adds a bill</div>
              <div style={{ fontSize: 13, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>Get a notification when someone adds an expense with you, pays you back, or a bill or chore is due.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <Btn size="md" busy={pushBusy} onClick={onPushOn} style={{ flex: 1 }}>Turn on</Btn>
            <Btn size="md" kind="secondary" disabled={pushBusy} onClick={onPushLater} style={{ flex: 1 }}>Not now</Btn>
          </div>
        </Card>
      )}

      {(show.runway || show.limit) && <div style={{ display: 'grid', gridTemplateColumns: show.runway && show.limit ? '1fr 1fr' : '1fr', gap: 12 }}>
        {show.runway && <Card T={T} onClick={() => setTab('money')} ariaLabel="Funds runway" style={{ padding: 14, borderRadius: 24 }}>
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
        </Card>}
        {show.limit && <Card T={T} onClick={() => setTab('work')} ariaLabel="Work limit" style={{ padding: 14, borderRadius: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, marginBottom: 10 }}>Work limit</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Ring pct={ws.daysUsed / ws.budget} size={54} stroke={6} color={toneC} track={T.border}><span style={{ fontSize: 14, fontWeight: 800 }}>{fixDe(ws.daysUsed, ws.daysUsed % 1 ? 1 : 0)}</span><span style={{ fontSize: 9, color: T.txt2 }}>days</span></Ring>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3, fontVariantNumeric: 'tabular-nums' }}>{fixDe(ws.weekH)} h</div>
              <div style={{ fontSize: 12, color: ws.weekH > ws.weekCap ? T.red : T.txt3, whiteSpace: 'nowrap' }}>of {ws.weekCap} h / week</div>
            </div>
          </div>
        </Card>}
      </div>}

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

      {hasMoney && (
        <>
          <SectionLabel T={T} right={<button type="button" className="h-link" style={{ fontSize: 13.5 }} onClick={onAllActivity}>See all</button>}>Activity</SectionLabel>
          <div style={{ marginBottom: 10 }}>
            <SegmentedControl T={T} label="Show" value={feed} onChange={pickFeed} options={[['mine', 'Your expenses'], ['all', 'Everything']]} />
          </div>
          <div className="glass" style={{ borderRadius: 24, overflow: 'hidden' }}>
            {feed === 'mine'
              ? (mine.length === 0
                ? <div style={{ padding: 18, color: T.txt2, fontSize: 14, lineHeight: 1.5 }}>No expenses with you yet. Add the first one — rent, groceries, the internet bill — and Splitlife splits it.</div>
                : mine.slice(0, 5).map((e) => <ExpenseRow key={e.id} {...{ T, e, cats, uid, nameOf }} place={mixed ? placeName(e.flat_id) : undefined} onClick={() => onOpenExpense(e)} />))
              : (activity.length === 0
                ? <div style={{ padding: 18, color: T.txt2, fontSize: 14, lineHeight: 1.5 }}>Nothing yet. Everything anyone adds, changes or ticks off in your groups shows up here.</div>
                : activity.slice(0, 5).map((a) => <ActivityRow key={a.id} {...{ T, a }} me={uid} name={(u) => (u ? nameOf(u) : 'Someone')} currency={curOf(a.flat_id)} place={mixed ? placeName(a.flat_id) : undefined} />))}
          </div>
        </>
      )}
    </>
  )
}

type Step = { id: string; title: string; sub: string; Icon: LucideIcon; done: boolean
  actions: { label: string; Icon?: LucideIcon; kind?: 'secondary'; onClick: () => void }[] }

/* Get started: the steps, done ones ticked, the next one open with its buttons */
function GetStarted({ T, steps, canHide, uid, onHide, showSignIn, onAuth }: {
  T: Theme; steps: Step[]; canHide: boolean; uid: string | null; onHide: () => void; showSignIn: boolean; onAuth: (m: AuthMode) => void
}) {
  const next = steps.find((x) => !x.done)?.id
  return (
    <Card T={T} grad={!canHide} style={{ padding: '18px 18px 10px', borderRadius: 28, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 750, fontSize: 20, letterSpacing: -0.4 }}>Get started</div>
          <div style={{ fontSize: 13, color: T.txt2, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{steps.filter((x) => x.done).length} of {steps.length} done</div>
        </div>
        {canHide && <button type="button" className="h-link" style={{ fontWeight: 650, fontSize: 14 }} onClick={onHide}>Hide</button>}
      </div>
      {steps.map((x, i) => {
        const open = x.id === next
        return (
          <div key={x.id} style={{ padding: '11px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }} aria-label={x.done ? `${x.title}, done` : undefined}>
              <span style={{ width: 30, height: 30, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: x.done ? TINT.green : open ? T.acc : T.border, color: x.done || open ? '#fff' : T.txt2 }}>
                {x.done ? <Check size={15} strokeWidth={3} /> : <x.Icon size={15} strokeWidth={2.4} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15.5, color: x.done ? T.txt2 : T.txt, textDecoration: x.done ? 'line-through' : 'none' }}>{x.title}</div>
                {open && <div style={{ fontSize: 13, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>{x.sub}</div>}
              </div>
            </div>
            {open && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10, paddingLeft: 42 }}>
                {x.actions.map((a) => <Btn key={a.label} size="md" kind={a.kind} icon={a.Icon} disabled={!uid} onClick={() => { haptic(8); a.onClick() }} style={{ flex: 1 }}>{a.label}</Btn>)}
              </div>
            )}
          </div>
        )
      })}
      {showSignIn && <div style={{ textAlign: 'center', fontSize: 13.5, color: T.txt2, margin: '6px 0 6px' }}>Been here before? <button type="button" className="h-link" onClick={() => onAuth('signin')}>Sign in</button></div>}
    </Card>
  )
}
