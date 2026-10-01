import { useState, useEffect, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Settings as SettingsIcon, WifiOff } from 'lucide-react'
import { sb, friendlyAuthError } from './lib/supabase'
import { LS } from './lib/storage'
import { tod, money, greeting, longToday } from './lib/format'
import { haptic, setHapticsEnabled } from './lib/haptic'
import { DK, LT } from './lib/theme'
import { NAV_ICON } from './icons'
import { computeRunway, computeWorkStats } from './lib/derive'
import { buildLedger, shareOf, pairwiseFor, toMajor } from './lib/ledger'
import type { SettleSuggestion } from './lib/derive'
import type { Profile, Runway, Shift, Flat, Member, Expense, Settlement, ListItem, FlatCategory, TabId, ModalId, PageId, AuthMode } from './lib/types'
import { mergeCats, slug } from './lib/data'
import { loadPrefs, savePrefs, systemDark, applyThemeToDocument } from './lib/prefs'
import type { Prefs } from './lib/prefs'
import Onboarding from './components/Onboarding'
import NoFlat from './components/tabs/NoFlat'
import HomeTab from './components/tabs/HomeTab'
import FlatTab from './components/tabs/FlatTab'
import MoneyTab from './components/tabs/MoneyTab'
import WorkTab from './components/tabs/WorkTab'
import ExpenseModal from './components/modals/ExpenseModal'
import type { ExpenseSave, ExpensePrefill } from './components/modals/ExpenseModal'
import { GroupsTab, NonGroupPage, PersonPage, PersonSettle } from './components/Friends'
import type { FriendsCtx } from './components/Friends'
import { Page } from './components/ui'
import { placeBooks, personName, isDirect } from './lib/places'
import type { PersonPick, PlaceLine } from './lib/places'
import { friendCircle, saveFriendExpense, settleWithPerson, remind as remindRpc, friendsMessage } from './lib/friends'
import ExpenseDetailModal from './components/modals/ExpenseDetailModal'
import CategoriesModal from './components/modals/CategoriesModal'
import SettleModal from './components/modals/SettleModal'
import InviteModal from './components/modals/InviteModal'
import CreateJoinModal from './components/modals/CreateJoinModal'
import RunwayModal from './components/modals/RunwayModal'
import ShiftModal from './components/modals/ShiftModal'
import ProfileModal from './components/modals/ProfileModal'
import AnalyticsModal from './components/modals/AnalyticsModal'
import AuthPage from './components/pages/AuthPage'
import ProfilePage from './components/pages/ProfilePage'
import SettingsPage from './components/pages/SettingsPage'
import Intro from './components/Intro'
import NotifPrompt from './components/NotifPrompt'
import ListPage from './components/ListPage'
import LiquidGlass from './components/LiquidGlass'
import { IconBtn, Avatar } from './components/ui'
import { pushSupported, needsInstall, permission as notifPermission, subscribe, initNativeListeners } from './lib/push'
import { isNative, hideSplash, applyStatusBarTheme, onHardwareBack, onAppResume, webOrigin, resetUrl } from './lib/native'
import { touchAppUser, appUserName } from './lib/appUser'
import { fetchRate } from './lib/rates'
import { deriveShift } from './lib/shift'
import { myShareTotal } from './lib/analytics'

const TABS: [TabId, string][] = [['home', 'Home'], ['flat', 'Groups'], ['money', 'Money'], ['work', 'Work']]

export default function App() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [sysDark, setSysDark] = useState(systemDark)
  const dark = prefs.theme === 'system' ? sysDark : prefs.theme === 'dark'
  const T = dark ? DK : LT
  const [profile, setProfile] = useState<Profile>(() => LS.g<Profile>('mt-h-profile') || { onboarded: false })
  const [runway, setRunway] = useState<Runway | null>(() => LS.g<Runway>('mt-h-runway'))
  const [shifts, setShifts] = useState<Shift[]>(() => LS.g<Shift[]>('mt-h-shifts') || [])
  const [tab, setTab] = useState<TabId>('home')
  const [modal, setModal] = useState<ModalId>(null)
  const [pages, setPages] = useState<PageId[]>([])
  const [auth, setAuth] = useState<AuthMode | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [shiftDate, setShiftDate] = useState<string | null>(null)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [expensePrefill, setExpensePrefill] = useState<ExpensePrefill | null>(null)
  const [settlePersonId, setSettlePersonId] = useState<string | null>(null)
  const [viewExpense, setViewExpense] = useState<Expense | null>(null)
  const [settleInit, setSettleInit] = useState<SettleSuggestion | null>(null)
  const [showIntro, setShowIntro] = useState(false)
  const [notifPrompt, setNotifPrompt] = useState<'enable' | 'install' | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)
  const [showList, setShowList] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  /* sync state */
  const [uid, setUid] = useState<string | null>(null)
  const [isAnon, setIsAnon] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [accountName, setAccountName] = useState<string | null>(null)
  const [authErr, setAuthErr] = useState<string | null>(null)
  const [flatId, setFlatId] = useState<string | null>(() => LS.g<string>('mt-h-flatid'))
  const [flat, setFlat] = useState<Flat | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settles, setSettles] = useState<Settlement[]>([])
  const [items, setItems] = useState<ListItem[]>([])
  const [flatCats, setFlatCats] = useState<FlatCategory[]>([])
  const [busy, setBusy] = useState(false)
  const [myFlats, setMyFlats] = useState<Flat[]>([])
  /* the hidden circles behind expenses outside any group, and every place's people,
     expenses and payments — for Groups, Non-group expenses, people's pages and Home */
  const [circles, setCircles] = useState<Flat[]>([])
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])
  const [allSettles, setAllSettles] = useState<Settlement[]>([])

  function save<Tv>(setter: Dispatch<SetStateAction<Tv>>, key: string) {
    return (v: Tv) => { setter(v); LS.s(key, v) }
  }
  const sProfile = save(setProfile, 'mt-h-profile')
  const sRunway = save(setRunway, 'mt-h-runway')
  const sShifts = save(setShifts, 'mt-h-shifts')
  const setPrefs = (p: Prefs) => { setPrefsState(p); savePrefs(p) }
  const showToast = (m: string) => {
    setToast(m)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }
  const setFlatIdP = (id: string | null) => { setFlatId(id); LS.s('mt-h-flatid', id) }

  /* theme: an explicit choice, or follow the phone */
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const f = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener?.('change', f)
    return () => mq.removeEventListener?.('change', f)
  }, [])
  useEffect(() => { applyThemeToDocument(dark, prefs.reduceGlass); applyStatusBarTheme(dark) }, [dark, prefs.reduceGlass])
  useEffect(() => { setHapticsEnabled(prefs.haptics) }, [prefs.haptics])
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [tab])

  const loadMyFlats = async () => {
    if (!sb || !uid) return
    const { data: mem } = await sb.from('flat_members').select('flat_id').eq('user_id', uid)
    const ids = [...new Set((mem || []).map((m: any) => m.flat_id))]
    if (!ids.length) { setMyFlats([]); setCircles([]); setFlatIdP(null); setAllMembers([]); setAllExpenses([]); setAllSettles([]); return }
    // a flat is a group; the hidden circles of expenses outside any group are kept apart
    const { data: fl } = await sb.from('flats').select('*').in('id', ids).order('created_at')
    const all = (fl as Flat[]) || []
    const list = all.filter((f) => !isDirect(f))
    setMyFlats(list)
    setCircles(all.filter(isDirect))
    const cur = LS.g<string>('mt-h-flatid')
    if (!cur || !list.some((f) => f.id === cur)) setFlatIdP(list[0] ? list[0].id : null)
    loadOverview(all.map((f) => f.id))
  }
  /* three queries for every group and circle at once */
  const loadOverview = async (ids?: string[]) => {
    if (!sb) return
    const list = ids || [...myFlats, ...circles].map((f) => f.id)
    if (!list.length) { setAllMembers([]); setAllExpenses([]); setAllSettles([]); return }
    const [m, e, st] = await Promise.all([
      sb.from('flat_members').select('*').in('flat_id', list),
      sb.from('expenses').select('*').in('flat_id', list).order('spent_on', { ascending: false }),
      sb.from('settlements').select('*').in('flat_id', list),
    ])
    if (!m.error && !e.error && !st.error) { setAllMembers((m.data as Member[]) || []); setAllExpenses((e.data as Expense[]) || []); setAllSettles((st.data as Settlement[]) || []) }
  }
  useEffect(() => { if (uid) loadMyFlats() }, [uid])

  const hostCur = profile.hostCur || 'EUR'
  const homeCur = profile.homeCur || hostCur
  const rate = profile.rate || 1
  const fH = (v: number) => money(v, hostCur)
  const fHome = (v: number) => (homeCur === hostCur ? null : money(v * rate, homeCur))
  const nameOf = (u: string) => (u === uid ? 'You' : (members.find((m) => m.user_id === u) || ({} as Member)).display_name || personName(allMembers, u))

  /* auth */
  const applySession = (session: any) => {
    if (!session) return
    setUid(session.user.id)
    setIsAnon(session.user.is_anonymous !== false)
    setEmail(session.user.email || null)
    setPendingEmail(session.user.new_email || null)
  }

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
        applySession(session)
      } catch (e: any) { setAuthErr(e?.message || "Couldn't connect") }
    })()
  }, [])

  useEffect(() => {
    if (!sb) return
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (event !== 'PASSWORD_RECOVERY') return
      applySession(session)
      setAuth('reset')
    })
    return () => data.subscription.unsubscribe()
  }, [])

  /* load flat data */
  const loadFlat = async () => {
    if (!sb || !flatId) return
    try {
      const [f, m, e, s, it, fc] = await Promise.all([
        sb.from('flats').select('*').eq('id', flatId).maybeSingle(),
        sb.from('flat_members').select('*').eq('flat_id', flatId),
        sb.from('expenses').select('*').eq('flat_id', flatId).order('spent_on', { ascending: false }),
        sb.from('settlements').select('*').eq('flat_id', flatId),
        sb.from('flat_items').select('*').eq('flat_id', flatId).order('created_at', { ascending: true }),
        sb.from('flat_categories').select('*').eq('flat_id', flatId).order('created_at', { ascending: true }),
      ])
      loadOverview()
      if (f.data) { setFlat(f.data as Flat); setMembers((m.data as Member[]) || []); setExpenses((e.data as Expense[]) || []); setSettles((s.data as Settlement[]) || []); setItems((it.data as ListItem[]) || []); setFlatCats((fc.data as FlatCategory[]) || []) }
      else { setFlatIdP(null); setFlat(null) }
    } catch { showToast('Sync error — will retry') }
  }
  useEffect(() => { if (uid && flatId) loadFlat(); else { setFlat(null); setMembers([]); setExpenses([]); setSettles([]); setItems([]); setFlatCats([]) } }, [uid, flatId])

  /* realtime */
  useEffect(() => {
    if (!sb || !uid || !flatId) return
    const client = sb
    const ch = client
      .channel('flat-' + flatId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: 'flat_id=eq.' + flatId }, (payload: any) => {
        if (payload.eventType === 'INSERT' && payload.new && payload.new.created_by !== uid) {
          const e = payload.new as Expense
          const share = shareOf(e, uid)
          showToast(`${nameOf(e.created_by)} added ${money(e.amount, e.currency || hostCur)}${share ? ` · you owe ${money(share, e.currency || hostCur)}` : ''}`)
          haptic(14)
        }
        loadFlat()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: 'flat_id=eq.' + flatId }, () => loadFlat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_members', filter: 'flat_id=eq.' + flatId }, () => loadFlat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_categories', filter: 'flat_id=eq.' + flatId }, () => loadFlat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_items', filter: 'flat_id=eq.' + flatId }, (payload: any) => {
        const n = payload.new
        if (payload.eventType === 'INSERT' && n && n.added_by !== uid) {
          showToast(`${nameOf(n.added_by)} added “${n.title}” to the list`); haptic(12)
        } else if (payload.eventType === 'UPDATE' && n && n.bought && n.bought_by && n.bought_by !== uid && !payload.old?.bought) {
          showToast(`${nameOf(n.bought_by)} bought “${n.title}”`); haptic(12)
        }
        loadFlat()
      })
      .subscribe()
    return () => { try { client.removeChannel(ch) } catch {} }
  }, [uid, flatId, members])

  /* Changes anywhere you can see — another group, a friend adding an expense with
     you — refresh the overview: realtime only delivers rows your access allows, so
     one unfiltered channel covers every group and circle. Bursts (a settle-up writes
     several payments) fold into one reload; a new place reloads the list of places. */
  const placeIds = [...myFlats, ...circles].map((f) => f.id).sort().join(',')
  useEffect(() => {
    if (!sb || !uid) return
    const client = sb
    let t: ReturnType<typeof setTimeout> | undefined
    const changed = () => {
      clearTimeout(t)
      t = setTimeout(async () => {
        const { data } = await client.from('flat_members').select('flat_id').eq('user_id', uid)
        const now = [...new Set((data || []).map((r: any) => r.flat_id as string))].sort().join(',')
        if (now !== placeIds) loadMyFlats(); else loadOverview()
      }, 400)
    }
    const ch = client.channel('mine-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flat_members' }, changed)
      .subscribe()
    return () => { clearTimeout(t); try { client.removeChannel(ch) } catch {} }
  }, [uid, placeIds])

  /* flat actions */
  const createFlat = async (nm: string) => {
    if (!sb || !uid) return showToast('Still connecting…')
    setBusy(true)
    const { data, error } = await sb.rpc('create_group', { p_name: nm, p_display_name: profile.name || 'Me' })
    setBusy(false)
    if (error) { showToast(error.message); return }
    haptic(14); setFlatIdP((data as any).id); await loadMyFlats(); setModal(null); setTab('flat'); setPages([`group:${(data as any).id}`]); showToast('Group created — invite the people you split with')
  }
  const joinFlat = async (code: string) => {
    if (!sb || !uid) return showToast('Still connecting…')
    setBusy(true)
    const { data, error } = await sb.rpc('join_flat', { p_code: (code || '').trim().toUpperCase(), p_display_name: profile.name || 'Me' })
    setBusy(false)
    if (error) { showToast("That code didn't match a group — check it and try again"); return }
    haptic(14); setFlatIdP((data as any).id); await loadMyFlats(); setModal(null); setTab('flat'); setPages([`group:${(data as any).id}`]); showToast(`Joined ${(data as any).name}`)
  }
  const saveExpense = async (x: ExpenseSave) => {
    if (!sb || !uid) return
    const cols = { description: x.description, amount: x.amount, currency: x.currency, paid_by: x.paid_by, split_among: x.split_among, split_type: x.split_type, split: x.split, payers: x.payers, category: x.category, spent_on: x.spent_on || tod() }
    let err: string | null = null
    if (circles.some((c) => c.id === x.place)) {
      // outside any group: the server finds or makes the circle for these people, and moves it when they change
      const people = allMembers.filter((m) => m.flat_id === x.place && m.user_id !== uid).map((m) => m.user_id)
      err = await saveFriendExpense(x.id, people, cols)
    } else {
      // the id is made in the form so the split shown before saving is the split saved
      const { error } = x.editing
        ? await sb.from('expenses').update(cols).eq('id', x.id)
        : await sb.from('expenses').insert({ ...cols, id: x.id, flat_id: x.place, created_by: uid })
      err = error ? friendsMessage(error, "Couldn't save — try again.") : null
    }
    if (err) { showToast(err); return }
    haptic(12); showToast(x.editing ? 'Expense updated' : 'Expense added'); loadFlat(); loadMyFlats()
  }
  const resolveCircle = async (picks: PersonPick[]): Promise<string | null> => {
    const c = await friendCircle(picks)
    if (typeof c === 'string') { showToast(c); return null }
    if (!circles.some((x) => x.id === c.id)) setCircles((cs) => [...cs, c])
    await loadOverview([...myFlats, ...circles, c].map((f) => f.id))
    return c.id
  }
  const inviteMember = async (mail: string, name: string): Promise<string | null> => {
    if (!sb || !flatId) return 'No group open'
    const { data, error } = await sb.rpc('invite_member', { p_flat: flatId, p_email: mail, p_name: name })
    if (error) return friendsMessage(error, "Couldn't add them right now. Please try again in a minute.")
    haptic(14); loadFlat()
    const m = data as Member
    showToast(m && !m.claimed_at ? `Invited ${m.display_name}` : `${m?.display_name || 'They'} are in`)
    return null
  }
  const revokeInvite = async (memberId: string) => {
    if (!sb) return
    const { error } = await sb.rpc('revoke_invite', { p_member: memberId })
    if (error) { showToast(friendsMessage(error, "Couldn't remove that invite")); return }
    showToast('Invite removed'); loadFlat()
  }
  const removeExpense = async (id: string) => {
    if (!sb || !confirm('Delete this expense for everyone in the flat?')) return
    // kept, hidden and restorable (engine v2, delete_expense), rather than gone for good
    const { error } = await sb.rpc('delete_expense', { p_id: id })
    if (error) { showToast(error.message); return }
    haptic(10); setModal(null); setEditExpense(null); showToast('Expense deleted'); loadFlat()
  }

  /* profile — a new name also reaches your flatmates */
  const syncName = async (nm: string) => {
    touchAppUser(nm)
    if (!sb || !uid) return
    // needs the display_name grant in supabase/migrations/20260911120000_member_display_name.sql;
    // until that is applied the update matches no rows and flatmates keep the old name
    const { data } = await sb.from('flat_members').update({ display_name: nm }).eq('user_id', uid).select('flat_id')
    if (data && data.length) loadFlat()
  }
  const saveProfile = (p: Profile) => {
    const renamed = !!p.name && p.name !== profile.name
    sProfile(p)
    if (renamed) syncName(p.name!)
  }

  /* account actions — an account is just the anonymous user with an email+password attached,
     so the user id (and therefore flat membership and every expense) stays the same */
  const signUp = async (name: string, mail: string, password: string): Promise<string | null> => {
    if (!sb) return 'Offline'
    setBusy(true)
    const { data, error } = await sb.auth.updateUser({ email: mail, password }, { emailRedirectTo: webOrigin() })
    setBusy(false)
    if (error) return friendlyAuthError(error, "Couldn't create the account right now. Please try again in a minute.")
    const { data: s } = await sb.auth.getSession()
    applySession(s.session)
    if (name && name !== profile.name) saveProfile({ ...profile, name })
    else touchAppUser(profile.name)
    haptic(14)
    // with email confirmation on, the address only attaches once the link is opened
    showToast(data.user?.email ? 'Account created — sign in on any device' : `Almost there — confirm ${mail} from the email we sent`)
    return null
  }
  const signIn = async (mail: string, password: string): Promise<string | null> => {
    if (!sb) return 'Offline'
    setBusy(true)
    const { data, error } = await sb.auth.signInWithPassword({ email: mail, password })
    setBusy(false)
    if (error) return friendlyAuthError(error, "Couldn't sign in right now. Please try again in a minute.")
    // the stale flat id from the throwaway anonymous session no longer applies
    LS.s('mt-h-flatid', null)
    setFlatId(null)
    applySession(data.session)
    touchAppUser(profile.name)
    appUserName().then((n) => { if (n) setAccountName(n) })
    haptic(14); showToast('Signed in')
    return null
  }
  /* Forgotten password. Supabase emails a link to Heimat's own reset page
     (reset.html) rather than into the app: the link is opened by whichever
     browser the mail app picks, often on a device that has never run Heimat, and
     the page has to say plainly that it is Heimat's and not MoneyTrack's — the
     two share this Supabase project. The in-app 'reset' screen stays as a
     fallback for links already sent. */
  const sendReset = async (mail: string): Promise<string | null> => {
    if (!sb) return 'Offline'
    setBusy(true)
    const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: resetUrl() })
    setBusy(false)
    return error ? friendlyAuthError(error, "Couldn't send the reset email right now. Please try again in a few minutes.") : null
  }
  const setPassword = async (password: string): Promise<string | null> => {
    if (!sb) return 'Offline'
    setBusy(true)
    const { error } = await sb.auth.updateUser({ password })
    setBusy(false)
    if (error) return friendlyAuthError(error, "Couldn't update the password right now. Please try again.")
    const { data } = await sb.auth.getSession()
    applySession(data.session)
    touchAppUser(profile.name)
    haptic(14); showToast('Password updated')
    return null
  }
  const changeEmail = async (mail: string): Promise<string | null> => {
    if (!sb) return 'Offline'
    setBusy(true)
    const { data, error } = await sb.auth.updateUser({ email: mail }, { emailRedirectTo: webOrigin() })
    setBusy(false)
    if (error) return friendlyAuthError(error, "Couldn't change the email right now. Please try again in a minute.")
    const u: any = data.user
    if (u?.email && u.email.toLowerCase() === mail.toLowerCase()) { setEmail(u.email); setPendingEmail(null) }
    else setPendingEmail(u?.new_email || mail)
    return null
  }

  /* App Store 5.1.1(v): an app that can create an account must be able to delete
     one. The edge function removes the user's memberships and the auth user
     itself; the flat's shared history stays, unattributed. */
  const deleteAccount = async () => {
    if (!sb) return showToast('Offline')
    if (!confirm('Delete your Heimat account?\n\nYou leave every flat you are in, and everything stored about you on the server is removed. Shared expenses stay with the flat, without your name on them. This cannot be undone.')) return
    setBusy(true)
    const { error } = await sb.functions.invoke('delete-account')
    setBusy(false)
    if (error) { showToast("Couldn't delete the account — try again"); return }
    await sb.auth.signOut().catch(() => {})
    ;['mt-h-profile', 'mt-h-runway', 'mt-h-shifts', 'mt-h-flatid', 'mt-h-notif-asked'].forEach((k) => {
      try { localStorage.removeItem(k) } catch {}
    })
    location.reload()
  }

  const signOut = async () => {
    if (!sb) return
    if (!confirm('Sign out? Your flat stays safe — sign back in any time with your email.')) return
    await sb.auth.signOut()
    setFlatIdP(null)
    setPages([])
    setAccountName(null)
    const { error } = await sb.auth.signInAnonymously()
    if (error) { setAuthErr(error.message); return }
    const { data } = await sb.auth.getSession()
    applySession(data.session)
    showToast('Signed out')
  }

  const clearLocal = () => {
    sShifts([]); sRunway(null)
    haptic(10); showToast('Shifts and runway cleared on this device')
  }

  /* category actions */
  const addCategory = async (label: string, icon: string, color: string) => {
    if (!sb || !flatId) return
    const { error } = await sb.from('flat_categories').insert({ flat_id: flatId, key: slug(label), label, icon, color, created_by: uid })
    if (error) { showToast(error.message); return }
    haptic(12); showToast(`“${label}” added`); loadFlat()
  }
  const deleteCategory = async (c: FlatCategory) => {
    if (!sb) return
    const used = expenses.filter((e) => e.category === c.key).length + items.filter((i) => i.category === c.key).length
    if (used > 0 && !confirm(`${used} item${used > 1 ? 's' : ''}/expense${used > 1 ? 's' : ''} use “${c.label}”. They'll show as “Other”. Delete anyway?`)) return
    const { error } = await sb.from('flat_categories').delete().eq('id', c.id)
    if (error) { showToast(error.message); return }
    haptic(10); showToast('Category deleted'); loadFlat()
  }

  /* shared list actions */
  const addItem = async (title: string, category: string) => {
    if (!sb || !flatId || !title.trim()) return
    const { error } = await sb.from('flat_items').insert({ flat_id: flatId, title: title.trim(), category, added_by: uid })
    if (error) { showToast(error.message); return }
    haptic(10); loadFlat()
  }
  const setItemBought = async (id: string, bought: boolean) => {
    if (!sb) return
    const { error } = await sb.from('flat_items').update(bought ? { bought: true, bought_by: uid, bought_at: new Date().toISOString() } : { bought: false, bought_by: null, bought_at: null }).eq('id', id)
    if (error) { showToast(error.message); return }
    haptic(12); loadFlat()
  }
  const deleteItem = async (id: string) => { if (!sb) return; const { error } = await sb.from('flat_items').delete().eq('id', id); if (!error) { haptic(8); loadFlat() } }
  const clearBoughtItems = async () => {
    if (!sb || !flatId) return
    const { error } = await sb.from('flat_items').delete().eq('flat_id', flatId).eq('bought', true)
    if (error) { showToast(error.message); return }
    haptic(10); showToast('Bought list cleared'); loadFlat()
  }
  /* turn the bought items into a shared expense: prefill the sheet, then clear them once it's saved */
  const expenseFromBought = () => {
    const bought = items.filter((i) => i.bought)
    if (!bought.length) return
    const counts: Record<string, number> = {}
    bought.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1 })
    const category = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'groceries'
    setEditExpense(null)
    setExpensePrefill({ desc: bought.map((i) => i.title).join(', '), category })
    setModal('exp')
  }
  const settleUp = async (from: string, to: string, amount: number) => {
    if (!sb) return
    // in the flat's own currency, so a payment always lands in the right balance
    const { error } = await sb.from('settlements').insert({ flat_id: flatId, from_user: from, to_user: to, amount, currency: ledger.currency, created_by: uid, settled_on: tod() })
    if (error) { showToast(error.message); return }
    haptic(12); showToast('Payment recorded'); loadFlat()
  }
  const leaveFlat = async () => {
    if (!sb) return
    if (!confirm("Leave this group? You'll stop seeing its shared bills.")) return
    const { error } = await sb.rpc('leave_flat', { p_flat: flatId })
    if (error) { showToast(friendsMessage(error, "Couldn't leave right now")); return }
    setPages([]); setFlatIdP(null); await loadMyFlats(); showToast('Left the group')
  }

  /* derived */
  const cats = useMemo(() => mergeCats(flatCats), [flatCats])
  const ledger = useMemo(() => buildLedger(expenses, settles, hostCur), [expenses, settles, hostCur])
  const balances = ledger.net
  const myNet = uid ? balances[uid] || 0 : 0
  const runwayCalc = useMemo(() => computeRunway(runway, expenses, uid), [runway, expenses, uid])
  /* every group's and circle's own books, and where you stand across all of them — in the
     currency most of them use; places in another currency are left out of the total rather
     than added to it as bare numbers (the same rule as the iOS app) */
  const books = useMemo(() => placeBooks(allExpenses, allSettles, hostCur), [allExpenses, allSettles, hostCur])
  const mainCur = useMemo(() => {
    const n = new Map<string, number>()
    for (const l of books.values()) if (l.owes.length) n.set(l.currency, (n.get(l.currency) || 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || hostCur
  }, [books, hostCur])
  const overallNet = useMemo(() => {
    if (!uid) return 0
    let v = 0
    for (const l of books.values()) if (l.currency === mainCur) for (const x of pairwiseFor(l.owes, uid).values()) v += x
    return toMajor(v, mainCur)
  }, [books, uid, mainCur])
  const workStats = useMemo(() => computeWorkStats(shifts, prefs), [shifts, prefs.weekCap, prefs.yearDays])

  const openShift = (d: string | null) => { setEditShift(null); setShiftDate(d || null); setModal('shift') }
  const openEditShift = (s: Shift) => { setEditShift(s); setShiftDate(null); setModal('shift') }
  const startAddExpense = () => { setEditExpense(null); setExpensePrefill(null); setModal('exp') }
  const addWith = (people: PersonPick[] | null) => { setEditExpense(null); setExpensePrefill({ people }); setModal('exp') }
  const openGroup = (id: string) => { haptic(8); setFlatIdP(id); setTab('flat'); setPages((st) => [...st.filter((x) => x !== `group:${id}`), `group:${id}`]) }
  const openEditExpense = (e: Expense) => { setEditExpense(e); setExpensePrefill(null); setModal('exp') }
  const openViewExpense = (e: Expense) => { setViewExpense(e); setModal('expdetail') }
  // you can edit an expense you added, or one someone else logged but you paid for
  const openExpense = (e: Expense) => { haptic(6); if (e.created_by === uid || e.paid_by === uid) openEditExpense(e); else openViewExpense(e) }
  const openSettle = (init: SettleSuggestion | null) => { setSettleInit(init); setModal('settle') }
  const openPage = (p: PageId) => { haptic(8); setPages((s) => [...s.filter((x) => x !== p), p]) }
  const closePage = () => setPages((s) => s.slice(0, -1))
  const closeModal = () => { setModal(null); setEditExpense(null); setExpensePrefill(null); setViewExpense(null); setSettleInit(null); setEditShift(null); setShiftDate(null); setSettlePersonId(null) }
  const recordSettle = async (person: string, lines: PlaceLine[], currency: string, pay: number, iPay: boolean, pair: string | null) => {
    if (!uid) return
    const err = await settleWithPerson(uid, person, personName(allMembers, person), lines, currency, pay, iPay, pair)
    if (err) { showToast(err); return }
    haptic(12); showToast('Payment recorded'); loadFlat(); loadMyFlats()
  }
  const remindPerson = async (person: string) => {
    const err = await remindRpc(person, linesFor(person), (id) => circles.some((c) => c.id === id), (id) => books.get(id)?.currency || hostCur)
    showToast(err || `Reminded ${personName(allMembers, person)}`)
  }
  const linesFor = (person: string): PlaceLine[] => {
    const out: PlaceLine[] = []
    if (!uid) return out
    for (const [id, l] of books) for (const b of l.books.values()) { const v = pairwiseFor(b.owes, uid).get(person) || 0; if (v) out.push({ place: id, currency: b.currency, minor: v }) }
    return out
  }

  const earnedTotal = useMemo(() => shifts.reduce((s, x) => s + deriveShift(x).pay, 0), [shifts])
  const spentTotal = useMemo(() => myShareTotal(expenses, uid, ledger.currency), [expenses, uid, ledger.currency])

  // live exchange rate — refresh at most once/day when currencies differ
  useEffect(() => {
    if (!profile.onboarded || !prefs.autoRate || homeCur === hostCur || profile.rateAt === tod()) return
    let cancelled = false
    fetchRate(hostCur, homeCur).then((r) => { if (!cancelled && r) sProfile({ ...profile, rate: r, rateAt: tod() }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.onboarded, hostCur, homeCur, prefs.autoRate])

  /* ---- native shell: splash, back button, resume, push taps ---- */
  useEffect(() => { hideSplash() }, [])
  useEffect(() => { if (isNative) initNativeListeners(() => { loadFlat(); loadMyFlats() }) }, [])
  useEffect(() => onAppResume(() => { if (uid && flatId) loadFlat() }), [uid, flatId])

  /* Android back: unwind whatever is on top, one layer per press. Returning
     false lets the shell minimise the app instead of killing it. */
  useEffect(() => onHardwareBack(() => {
    if (auth) { setAuth(null); return true }
    if (showIntro) { setShowIntro(false); return true }
    if (notifPrompt) { dismissNotifPrompt(); return true }
    if (modal) { closeModal(); return true }
    if (showList) { setShowList(false); return true }
    if (pages.length) { closePage(); return true }
    if (tab !== 'home') { setTab('home'); return true }
    return false
  }), [auth, showIntro, notifPrompt, modal, showList, pages, tab])

  /* once you're in a flat, offer notifications on your own — most people don't find the toggle.
     Shown at most once (until dismissed) and never after you've already answered the browser prompt. */
  useEffect(() => {
    if (!flatId || notifPrompt || LS.g<boolean>('mt-h-notif-asked')) return
    if (needsInstall()) { setNotifPrompt('install'); return }
    let cancelled = false
    // 'default' means the OS prompt was never answered, so no subscription can exist yet
    if (pushSupported()) notifPermission().then((p) => { if (!cancelled && p === 'default') setNotifPrompt('enable') })
    return () => { cancelled = true }
  }, [flatId, notifPrompt])

  const dismissNotifPrompt = () => { LS.s('mt-h-notif-asked', true); setNotifPrompt(null) }
  const enableNotif = async () => {
    setNotifBusy(true)
    const r = await subscribe()
    setNotifBusy(false)
    LS.s('mt-h-notif-asked', true)
    setNotifPrompt(null)
    if (r.ok) showToast('Notifications on')
    else if (r.reason === 'denied') showToast(isNative ? 'Blocked — allow Heimat in Settings → Notifications' : 'Blocked — allow Heimat in your browser settings')
    else if (r.reason === 'install') showToast('Add Heimat to your Home Screen first')
    else showToast("Couldn't turn on notifications")
  }

  const toastEl = toast && <div className="h-toast glass glass-strong" role="status">{toast}</div>
  const authEl = auth && (
    <AuthPage {...{ T, mode: auth, setMode: setAuth, onClose: () => setAuth(null), busy, isAnon, inFlat: !!flat, email, defaultName: profile.name, signUp, signIn, sendReset, setPassword, changeEmail }} />
  )

  if (!profile.onboarded) {
    return (
      <div className="h-app h-aurora">
        <Onboarding T={T} isAnon={isAnon} accountName={accountName} onSignIn={() => setAuth('signin')} onDone={(p, next) => { saveProfile(p); if (next === 'signup') setAuth('signup') }} />
        {authEl}
        {toastEl}
      </div>
    )
  }

  const inFlat = !!flat
  const firstName = (profile.name || '').trim().split(/\s+/)[0]
  const [kicker, title] = tab === 'home' ? [greeting(), firstName || 'Heimat'] : tab === 'flat' ? [longToday(), 'Groups'] : [longToday(), tab === 'money' ? 'Money' : 'Work']
  const fc: FriendsCtx = {
    T, uid, hostCur, main: mainCur, groups: myFlats, circles, members: allMembers, expenses: allExpenses, books, cats,
    openPage, openGroup, invite: (id) => { setFlatIdP(id); setModal('invite') }, openExpense, addWith,
    settlePerson: (id) => { setSettlePersonId(id); setModal('settleperson') }, remindPerson,
    newGroup: () => setModal('create'), join: () => setModal('join'), showToast,
  }
  const placesCount = myFlats.length + (circles.length ? 1 : 0)
  const scope = placesCount > 1 ? `Across ${myFlats.length} ${myFlats.length === 1 ? 'group' : 'groups'}${circles.length ? ' and friends' : ''}` : flat ? `Your balance · ${flat.name}` : 'Your balance'
  const tabIdx = TABS.findIndex(([id]) => id === tab)
  const openSettings = () => openPage('settings')

  return (
    <div className="h-app h-aurora">
      {toastEl}

      <main ref={mainRef} className="h-main">
        <div key={tab} className="h-main-in h-stagger">
          {tab === 'home' && <HomeTab {...{ T, flat, scope, hasMoney: !!flat || circles.length > 0, uid, isAnon, myNet: overallNet, runwayCalc, runway, workStats, fH, fHome, setModal, setTab, expenses, nameOf, startAddExpense, cats, openList: () => setShowList(true), openCount: items.filter((i) => !i.bought).length, onLogShift: () => openShift(null), openSettle: (sg: SettleSuggestion | null) => (flat ? openSettle(sg) : (setTab('flat'), setPages(['nongroup']))), onOpenExpense: openExpense, onAuth: setAuth }} />}
          {tab === 'flat' && (uid || !authErr ? <GroupsTab c={fc} /> : <NoFlat T={T} setModal={setModal} authErr={authErr} uid={uid} isAnon={isAnon} onSignIn={() => setAuth('signin')} />)}
          {tab === 'money' && <MoneyTab {...{ T, runway, runwayCalc, fH, fHome, hostCur, homeCur, rate, rateAt: profile.rateAt, setModal, inFlat, openSettings }} />}
          {tab === 'work' && <WorkTab {...{ T, workStats, shifts, fH, fHome, onLogShift: openShift, onEditShift: openEditShift, openSettings }} />}
        </div>
      </main>

      <header className="h-hdr">
        <div className="h-hdr-fx" />
        <div className="h-hdr-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h-kicker">{kicker}</div>
            <h1 className="h-title">{title}</h1>
          </div>
          {authErr && <span className="h-pill" style={{ background: 'color-mix(in srgb, var(--amber) 16%, transparent)', color: T.amber }}><WifiOff size={13} /> Offline</span>}
          <IconBtn label="Settings" onClick={openSettings}><SettingsIcon size={20} /></IconBtn>
          <button type="button" className="h-avbtn" aria-label="Your profile" onClick={() => openPage('profile')}><Avatar name={profile.name} color={profile.avatar} seed={uid || profile.name} size={42} /></button>
        </div>
      </header>

      <nav className="h-tabbar" aria-label="Sections">
        <LiquidGlass radius={33} className="h-tabbar-in">
          <span className="h-tab-ind" style={{ width: `calc((100% - 12px) / ${TABS.length})`, transform: `translateX(${tabIdx * 100}%)` }} />
          {TABS.map(([id, label]) => {
            const NIcon = NAV_ICON[id]
            const on = tab === id
            return (
              <button key={id} type="button" className="h-tab" aria-current={on ? 'page' : undefined} onClick={() => { if (!on) { haptic(8); setTab(id) } else mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                <NIcon size={23} strokeWidth={on ? 2.3 : 1.9} />
                <span>{label}</span>
              </button>
            )
          })}
        </LiquidGlass>
      </nav>

      {pages.map((p) => p === 'profile'
        ? <ProfilePage key="profile" {...{ T, profile, uid, isAnon, email, pendingEmail, myFlats, flatId, earnedTotal, spentTotal, shiftCount: shifts.length, runwayCalc, fH, onBack: closePage, onAuth: setAuth, onSwitchFlat: (id: string) => { setPages([]); openGroup(id) }, setModal, onOpenSettings: openSettings }} />
        : p === 'settings'
        ? <SettingsPage key="settings" {...{ T, prefs, setPrefs, profile, sProfile, uid, isAnon, email, pendingEmail, shifts, runway, onBack: closePage, onAuth: setAuth, onSignOut: signOut, onDeleteAccount: deleteAccount, onReplayIntro: () => setShowIntro(true), onEditProfile: () => setModal('profile'), showToast, clearLocal }} />
        : p === 'nongroup'
        ? <NonGroupPage key={p} c={fc} onBack={closePage} />
        : p.startsWith('person:')
        ? <PersonPage key={p} c={fc} person={p.slice(7)} onBack={closePage} />
        : (
          <Page key={p} T={T} title={myFlats.find((f) => f.id === p.slice(6))?.name || ''} onBack={closePage}>
            {flat && flat.id === p.slice(6)
              ? <FlatTab {...{ T, flat, members, ledger, uid, fH, nameOf, setModal, leaveFlat, expenses, onOpenExpense: openExpense, openSettle, items, openList: () => setShowList(true), startAddExpense, openAnalytics: () => setModal('analytics'), cats, showToast, onPerson: (id: string) => openPage(`person:${id}`) }} />
              : <div style={{ padding: 24, textAlign: 'center', color: T.txt3 }}>Loading…</div>}
          </Page>
        ))}

      <ExpenseModal {...{ open: modal === 'exp', onClose: closeModal, c: fc, start: flatId, editing: editExpense, prefill: expensePrefill, hostCur, homeCur, rate, cats, openCategories: () => setModal('cats'), save: saveExpense, resolve: resolveCircle }} onDelete={editExpense ? () => removeExpense(editExpense.id) : undefined} />
      <PersonSettle c={fc} open={modal === 'settleperson'} person={settlePersonId} onClose={closeModal} record={recordSettle} />
      <SettleModal {...{ open: modal === 'settle', onClose: closeModal, T, members, ledger, uid, nameOf, fH, settleUp, initial: settleInit }} />
      <ExpenseDetailModal {...{ open: modal === 'expdetail', onClose: closeModal, T, expense: viewExpense, fH, nameOf, cats }} />
      <CategoriesModal {...{ open: modal === 'cats', onClose: closeModal, T, custom: flatCats, addCategory, deleteCategory }} />
      <InviteModal {...{ open: modal === 'invite', onClose: closeModal, T, flat, members, invite: inviteMember, revoke: revokeInvite, showToast }} />
      <CreateJoinModal {...{ open: modal === 'create' || modal === 'join', mode: modal, onClose: closeModal, T, createFlat, joinFlat, busy, profile }} />
      <RunwayModal {...{ open: modal === 'runway', onClose: closeModal, T, runway, sRunway, hostCur, showToast }} />
      <ShiftModal {...{ open: modal === 'shift', onClose: closeModal, T, shifts, sShifts, showToast, hostCur, initialDate: shiftDate, editing: editShift }} />
      <ProfileModal {...{ open: modal === 'profile', onClose: closeModal, T, profile, uid, onSave: (p: Profile) => { saveProfile(p); showToast('Profile saved') } }} />
      <AnalyticsModal {...{ open: modal === 'analytics', onClose: closeModal, T, expenses, members, uid, fH, nameOf, cats, currency: ledger.currency }} />
      {showList && inFlat && <ListPage {...{ T, onClose: () => setShowList(false), items, nameOf, addItem, setItemBought, deleteItem, clearBoughtItems, expenseFromBought: () => { setShowList(false); expenseFromBought() }, cats, openCategories: () => setModal('cats') }} />}
      {showIntro && <Intro T={T} onClose={() => setShowIntro(false)} />}
      {notifPrompt && !showIntro && <NotifPrompt {...{ T, mode: notifPrompt, busy: notifBusy, onEnable: enableNotif, onDismiss: dismissNotifPrompt }} />}
      {authEl}
    </div>
  )
}
