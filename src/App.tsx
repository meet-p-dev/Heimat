import { useState, useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Sun, Moon } from 'lucide-react'
import { sb } from './lib/supabase'
import { LS } from './lib/storage'
import { tod, money } from './lib/format'
import { haptic } from './lib/haptic'
import { DK, LT } from './lib/theme'
import { NAV_ICON } from './icons'
import { computeBalances, computeRunway, computeWorkStats } from './lib/derive'
import type { SettleSuggestion } from './lib/derive'
import type { Profile, Runway, Shift, Flat, Member, Expense, Settlement, TabId, ModalId } from './lib/types'
import Onboarding from './components/Onboarding'
import NoFlat from './components/tabs/NoFlat'
import HomeTab from './components/tabs/HomeTab'
import FlatTab from './components/tabs/FlatTab'
import MoneyTab from './components/tabs/MoneyTab'
import WorkTab from './components/tabs/WorkTab'
import MeTab from './components/tabs/MeTab'
import ExpenseModal from './components/modals/ExpenseModal'
import ExpenseDetailModal from './components/modals/ExpenseDetailModal'
import SettleModal from './components/modals/SettleModal'
import InviteModal from './components/modals/InviteModal'
import CreateJoinModal from './components/modals/CreateJoinModal'
import RunwayModal from './components/modals/RunwayModal'
import ShiftModal from './components/modals/ShiftModal'
import PickFlatModal from './components/modals/PickFlatModal'
import ProfileModal from './components/modals/ProfileModal'
import AnalyticsModal from './components/modals/AnalyticsModal'
import Intro from './components/Intro'
import { fetchRate } from './lib/rates'
import { deriveShift } from './lib/shift'
import { myShareTotal } from './lib/analytics'

const TABS: [TabId, string][] = [['home', 'Home'], ['flat', 'Flat'], ['money', 'Money'], ['work', 'Work'], ['me', 'Me']]

export default function App() {
  const [dark, setDark] = useState<boolean>(() => { const v = LS.g<boolean>('mt-h-dark'); return v == null ? true : v })
  const T = dark ? DK : LT
  const [profile, setProfile] = useState<Profile>(() => LS.g<Profile>('mt-h-profile') || { onboarded: false })
  const [runway, setRunway] = useState<Runway | null>(() => LS.g<Runway>('mt-h-runway'))
  const [shifts, setShifts] = useState<Shift[]>(() => LS.g<Shift[]>('mt-h-shifts') || [])
  const [tab, setTab] = useState<TabId>('home')
  const [modal, setModal] = useState<ModalId>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [shiftDate, setShiftDate] = useState<string | null>(null)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [viewExpense, setViewExpense] = useState<Expense | null>(null)
  const [settleInit, setSettleInit] = useState<SettleSuggestion | null>(null)
  const [showIntro, setShowIntro] = useState(false)

  /* sync state */
  const [uid, setUid] = useState<string | null>(null)
  const [authErr, setAuthErr] = useState<string | null>(null)
  const [flatId, setFlatId] = useState<string | null>(() => LS.g<string>('mt-h-flatid'))
  const [flat, setFlat] = useState<Flat | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settles, setSettles] = useState<Settlement[]>([])
  const [busy, setBusy] = useState(false)
  const [myFlats, setMyFlats] = useState<Flat[]>([])

  function save<Tv>(setter: Dispatch<SetStateAction<Tv>>, key: string) {
    return (v: Tv) => { setter(v); LS.s(key, v) }
  }
  const sProfile = save(setProfile, 'mt-h-profile')
  const sRunway = save(setRunway, 'mt-h-runway')
  const sShifts = save(setShifts, 'mt-h-shifts')
  const tgDark = () => { const n = !dark; setDark(n); LS.s('mt-h-dark', n) }
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600) }
  const setFlatIdP = (id: string | null) => { setFlatId(id); LS.s('mt-h-flatid', id) }

  const loadMyFlats = async () => {
    if (!sb || !uid) return
    const { data: mem } = await sb.from('flat_members').select('flat_id').eq('user_id', uid)
    const ids = [...new Set((mem || []).map((m: any) => m.flat_id))]
    if (!ids.length) { setMyFlats([]); setFlatIdP(null); return }
    const { data: fl } = await sb.from('flats').select('*').in('id', ids)
    const list = (fl as Flat[]) || []
    setMyFlats(list)
    const cur = LS.g<string>('mt-h-flatid')
    if (!cur || !list.some((f) => f.id === cur)) setFlatIdP(list[0] ? list[0].id : null)
  }
  useEffect(() => { if (uid) loadMyFlats() }, [uid])

  const hostCur = profile.hostCur || 'EUR'
  const homeCur = profile.homeCur || hostCur
  const rate = profile.rate || 1
  const fH = (v: number) => money(v, hostCur)
  const fHome = (v: number) => (homeCur === hostCur ? null : money(v * rate, homeCur))
  const nameOf = (u: string) => (u === uid ? 'You' : (members.find((m) => m.user_id === u) || ({} as Member)).display_name || 'Someone')

  /* auth */
  useEffect(() => {
    ;(async () => {
      if (!sb) { setAuthErr('offline'); return }
      try {
        const first = await sb.auth.getSession()
        let session = first.data.session
        if (!session) {
          const { error } = await sb.auth.signInAnonymously()
          if (error) throw error
          const again = await sb.auth.getSession()
          session = again.data.session
        }
        if (session) setUid(session.user.id)
      } catch (e: any) { setAuthErr(e?.message || "Couldn't connect") }
    })()
  }, [])

  /* load flat data */
  const loadFlat = async () => {
    if (!sb || !flatId) return
    try {
      const [f, m, e, s] = await Promise.all([
        sb.from('flats').select('*').eq('id', flatId).maybeSingle(),
        sb.from('flat_members').select('*').eq('flat_id', flatId),
        sb.from('expenses').select('*').eq('flat_id', flatId).order('spent_on', { ascending: false }),
        sb.from('settlements').select('*').eq('flat_id', flatId),
      ])
      if (f.data) { setFlat(f.data as Flat); setMembers((m.data as Member[]) || []); setExpenses((e.data as Expense[]) || []); setSettles((s.data as Settlement[]) || []) }
      else { setFlatIdP(null); setFlat(null) }
    } catch { showToast('Sync error — will retry') }
  }
  useEffect(() => { if (uid && flatId) loadFlat(); else { setFlat(null); setMembers([]); setExpenses([]); setSettles([]) } }, [uid, flatId])

  /* realtime */
  useEffect(() => {
    if (!sb || !uid || !flatId) return
    const client = sb
    const ch = client
      .channel('flat-' + flatId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: 'flat_id=eq.' + flatId }, (payload: any) => {
        if (payload.eventType === 'INSERT' && payload.new && payload.new.created_by !== uid) {
          const e = payload.new
          const parts = e.split_among || []
          const share = parts.includes(uid) ? e.amount / Math.max(parts.length, 1) : 0
          showToast(`${nameOf(e.created_by)} added ${money(e.amount, e.currency || hostCur)}${share ? ` · you owe ${money(share, e.currency || hostCur)}` : ''}`)
          haptic(14)
        }
        loadFlat()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: 'flat_id=eq.' + flatId }, () => loadFlat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_members', filter: 'flat_id=eq.' + flatId }, () => loadFlat())
      .subscribe()
    return () => { try { client.removeChannel(ch) } catch {} }
  }, [uid, flatId, members])

  /* flat actions */
  const createFlat = async (nm: string) => {
    if (!sb || !uid) return showToast('Still connecting…')
    setBusy(true)
    const { data, error } = await sb.rpc('create_flat', { p_name: nm, p_display_name: profile.name || 'Me' })
    setBusy(false)
    if (error) { showToast(error.message); return }
    haptic(14); setFlatIdP((data as any).id); await loadMyFlats(); setModal(null); showToast('Flat created')
  }
  const joinFlat = async (code: string) => {
    if (!sb || !uid) return showToast('Still connecting…')
    setBusy(true)
    const { data, error } = await sb.rpc('join_flat', { p_code: (code || '').trim().toUpperCase(), p_display_name: profile.name || 'Me' })
    setBusy(false)
    if (error) { showToast('Invalid code'); return }
    haptic(14); setFlatIdP((data as any).id); await loadMyFlats(); setModal(null); showToast('Joined flat')
  }
  const addExpense = async (x: { desc: string; amount: number; paidBy: string; among: string[]; category: string }) => {
    if (!sb || !flatId) return
    const { error } = await sb.from('expenses').insert({ flat_id: flatId, description: x.desc, amount: x.amount, currency: hostCur, paid_by: x.paidBy, split_among: x.among, category: x.category, created_by: uid, spent_on: tod() })
    if (error) { showToast(error.message); return }
    haptic(12); showToast('Expense added'); loadFlat()
  }
  const updateExpense = async (id: string, x: { desc: string; amount: number; paidBy: string; among: string[]; category: string }) => {
    if (!sb) return
    const { error } = await sb.from('expenses').update({ description: x.desc, amount: x.amount, paid_by: x.paidBy, split_among: x.among, category: x.category }).eq('id', id)
    if (error) { showToast(error.message); return }
    haptic(12); showToast('Expense updated'); loadFlat()
  }
  const deleteExpense = async (id: string) => { if (!sb) return; const { error } = await sb.from('expenses').delete().eq('id', id); if (!error) { showToast('Deleted'); loadFlat() } }
  const settleUp = async (from: string, to: string, amount: number) => {
    if (!sb) return
    const { error } = await sb.from('settlements').insert({ flat_id: flatId, from_user: from, to_user: to, amount, created_by: uid, settled_on: tod() })
    if (error) { showToast(error.message); return }
    haptic(12); showToast('Payment recorded'); loadFlat()
  }
  const leaveFlat = async () => {
    if (!sb) return
    if (!confirm("Leave this flat? You'll stop seeing its shared bills.")) return
    await sb.from('flat_members').delete().eq('flat_id', flatId).eq('user_id', uid)
    setFlatIdP(null); await loadMyFlats(); showToast('Left flat')
  }

  /* derived */
  const balances = useMemo(() => computeBalances(members, expenses, settles), [members, expenses, settles])
  const myNet = uid ? balances[uid] || 0 : 0
  const runwayCalc = useMemo(() => computeRunway(runway, expenses, uid), [runway, expenses, uid])
  const workStats = useMemo(() => computeWorkStats(shifts), [shifts])

  const openShift = (d: string | null) => { setEditShift(null); setShiftDate(d || null); setModal('shift') }
  const openEditShift = (s: Shift) => { setEditShift(s); setShiftDate(null); setModal('shift') }
  const startAddExpense = () => { setEditExpense(null); if ((myFlats || []).length > 1) setModal('pickflat'); else setModal('exp') }
  const openEditExpense = (e: Expense) => { setEditExpense(e); setModal('exp') }
  const openViewExpense = (e: Expense) => { setViewExpense(e); setModal('expdetail') }
  const openSettle = (init: SettleSuggestion | null) => { setSettleInit(init); setModal('settle') }

  const earnedTotal = useMemo(() => shifts.reduce((s, x) => s + deriveShift(x).pay, 0), [shifts])
  const spentTotal = useMemo(() => myShareTotal(expenses, uid), [expenses, uid])

  // live exchange rate — refresh at most once/day when currencies differ
  useEffect(() => {
    if (!profile.onboarded || homeCur === hostCur || profile.rateAt === tod()) return
    let cancelled = false
    fetchRate(hostCur, homeCur).then((r) => { if (!cancelled && r) sProfile({ ...profile, rate: r, rateAt: tod() }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.onboarded, hostCur, homeCur])

  if (!profile.onboarded) return <div style={{ height: '100%', background: T.bg }}><Onboarding T={T} onDone={(p) => sProfile(p)} /></div>

  const inFlat = !!flat

  return (
    <div className="h-app" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg, color: T.txt }}>
      {toast && <div style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top) + 12px)', left: '50%', transform: 'translateX(-50%)', zIndex: 999, maxWidth: '90%', background: T.card, color: T.txt, border: `1px solid ${T.border}`, borderRadius: 14, padding: '10px 18px', fontSize: 14, fontWeight: 600, boxShadow: '0 8px 28px rgba(0,0,0,.4)', textAlign: 'center' }}>{toast}</div>}

      <div style={{ flexShrink: 0, paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 6px' }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>Heimat</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 11, color: authErr ? T.amber : uid ? T.green : T.txt3, fontWeight: 600 }}>{authErr ? 'offline' : uid ? '●' : '…'}</span>
            <button onClick={tgDark} className="h-press" style={{ background: 'none', border: 'none', color: T.txt2, cursor: 'pointer', display: 'flex', padding: 0 }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div className="h-stagger" style={{ padding: '6px 16px calc(env(safe-area-inset-bottom) + 120px)' }}>
          {tab === 'home' && (inFlat
            ? <HomeTab {...{ T, flat: flat!, myNet, runwayCalc, runway, fH, fHome, setModal, setTab, expenses, nameOf, startAddExpense }} />
            : <NoFlat T={T} setModal={setModal} authErr={authErr} uid={uid} />)}
          {tab === 'flat' && (inFlat
            ? <FlatTab {...{ T, flat: flat!, members, balances, uid, fH, nameOf, setModal, leaveFlat, expenses, deleteExpense, onEditExpense: openEditExpense, onViewExpense: openViewExpense, openSettle, myFlats, flatId, switchFlat: setFlatIdP, startAddExpense, openAnalytics: () => setModal('analytics') }} />
            : <NoFlat T={T} setModal={setModal} authErr={authErr} uid={uid} />)}
          {tab === 'money' && <MoneyTab {...{ T, runway, runwayCalc, fH, fHome, hostCur, homeCur, rate, profile, setModal, inFlat }} />}
          {tab === 'work' && <WorkTab {...{ T, workStats, shifts, sShifts, fH, fHome, hostCur, showToast, onLogShift: openShift, onEditShift: openEditShift }} />}
          {tab === 'me' && <MeTab {...{ T, profile, sProfile, dark, tgDark, showToast, uid, flat, leaveFlat, onEditProfile: () => setModal('profile'), onReplayIntro: () => setShowIntro(true) }} />}
        </div>
      </div>

      <div className="h-nav" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90, paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', paddingTop: 6, background: dark ? 'rgba(12,17,16,.86)' : 'rgba(243,246,242,.9)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', maxWidth: 480, margin: '0 auto' }}>
          {TABS.map(([id, label]) => {
            const on = tab === id
            const NIcon = NAV_ICON[id]
            return (
              <button key={id} onClick={() => { haptic(8); setTab(id) }} style={{ flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', color: on ? T.acc : T.txt3 }}>
                <NIcon size={22} strokeWidth={1.9} color={on ? T.acc : T.txt3} />
                <span style={{ fontSize: 10, fontWeight: on ? 700 : 500 }}>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <ExpenseModal {...{ open: modal === 'exp', onClose: () => { setModal(null); setEditExpense(null) }, T, members, uid, addExpense, updateExpense, editing: editExpense, hostCur, homeCur, rate, flatName: flat ? flat.name : '' }} />
      <PickFlatModal {...{ open: modal === 'pickflat', onClose: () => setModal(null), T, myFlats, flatId, onPick: (id: string) => { setFlatIdP(id); setModal('exp') } }} />
      <SettleModal {...{ open: modal === 'settle', onClose: () => { setModal(null); setSettleInit(null) }, T, members, balances, uid, nameOf, fH, settleUp, initial: settleInit }} />
      <ExpenseDetailModal {...{ open: modal === 'expdetail', onClose: () => { setModal(null); setViewExpense(null) }, T, expense: viewExpense, fH, nameOf }} />
      <InviteModal {...{ open: modal === 'invite', onClose: () => setModal(null), T, flat, showToast }} />
      <CreateJoinModal {...{ open: modal === 'create' || modal === 'join', mode: modal, onClose: () => setModal(null), T, createFlat, joinFlat, busy, profile }} />
      <RunwayModal {...{ open: modal === 'runway', onClose: () => setModal(null), T, runway, sRunway, hostCur, showToast }} />
      <ShiftModal {...{ open: modal === 'shift', onClose: () => { setModal(null); setShiftDate(null); setEditShift(null) }, T, shifts, sShifts, showToast, hostCur, initialDate: shiftDate, editing: editShift }} />
      <ProfileModal {...{ open: modal === 'profile', onClose: () => setModal(null), T, profile, sProfile, showToast, earnedTotal, spentTotal, shiftCount: shifts.length, fH }} />
      <AnalyticsModal {...{ open: modal === 'analytics', onClose: () => setModal(null), T, expenses, members, uid, fH, nameOf }} />
      {showIntro && <Intro T={T} onClose={() => setShowIntro(false)} />}
    </div>
  )
}
