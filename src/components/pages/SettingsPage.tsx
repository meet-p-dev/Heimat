import { useState, useEffect } from 'react'
import {
  Palette, Droplets, Bell, Send, Globe, RefreshCw, CalendarDays, Timer, RotateCcw, Vibrate, Download, Upload, FileSpreadsheet, Trash2, Shield,
  FileText, ExternalLink, ChevronRight, Info, Clock, Users,
} from 'lucide-react'
import type { Theme, Profile, Shift, Runway } from '../../lib/types'
import type { Prefs, ThemeMode } from '../../lib/prefs'
import { DEFAULT_PREFS } from '../../lib/prefs'
import { fixDe, rateDe, numVal, relDay, tod } from '../../lib/format'
import { fetchRate } from '../../lib/rates'
import { pushSupported, needsInstall, isSubscribed, subscribe, unsubscribe, subscribeError, sendTestNotification, pushMissingInBuild } from '../../lib/push'
import { dailyReminderHour, setDailyReminder } from '../../lib/reminders'
import { isNative, isNativeAndroid, openExternal, webOrigin, copyText } from '../../lib/native'
import { saveTextFile, shiftsCsv } from '../../lib/exportData'
import { importShifts } from '../../lib/importShifts'
import { SplitwiseImports } from '../modals/SplitwiseImportModal'
import { Page, Group, Item, Toggle, Stepper, SegmentedControl, Sheet, Field, Btn, Avatar, TINT } from '../ui'
import { LifeSettingsItem } from '../Life'
import { partOn } from '../../lib/life'

const THEMES: [ThemeMode, string][] = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']]

export default function SettingsPage({ T, prefs, setPrefs, profile, sProfile, uid, isAnon, shifts, runway, onBack, onOpenProfile, onReplayIntro, onEditProfile, showToast, clearLocal, addShifts, onImportSplitwise, placeNames, onPlacesChanged }: {
  T: Theme; prefs: Prefs; setPrefs: (p: Prefs) => void; profile: Profile; sProfile: (p: Profile) => void
  uid: string | null; isAnon: boolean
  shifts: Shift[]; runway: Runway | null
  addShifts: (s: Shift[]) => void
  onImportSplitwise: () => void; placeNames: Record<string, string>; onPlacesChanged: () => void
  onBack: () => void; onOpenProfile: () => void
  onReplayIntro: () => void; onEditProfile: () => void; showToast: (m: string) => void; clearLocal: () => void
}) {
  const [notif, setNotif] = useState(false)
  const [notifBusy, setNotifBusy] = useState(false)
  // the test notification: waiting on the server, then what it said
  const [testBusy, setTestBusy] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [rateOpen, setRateOpen] = useState(false)
  const [rate, setRate] = useState('')
  const [fetching, setFetching] = useState(false)
  /* a page inside Settings: Notifications, Currency, Work limits, Export & import */
  const [page, setPage] = useState<null | 'notif' | 'currency' | 'limits' | 'data'>(null)
  useEffect(() => { isSubscribed().then(setNotif).catch(() => {}) }, [])
  /* the daily "anything to add today?": its local hour, null = off, undefined = not loaded */
  const [daily, setDaily] = useState<number | null | undefined>(undefined)
  const [dailyHour, setDailyHour] = useState(20)
  useEffect(() => { if (page === 'notif') dailyReminderHour(uid).then((h) => { setDaily(h); if (h != null) setDailyHour(h) }) }, [page, uid])
  const saveDaily = async (h: number | null) => {
    const was = daily
    setDaily(h); if (h != null) setDailyHour(h)
    if (!(await setDailyReminder(uid, h))) { setDaily(was); showToast("Couldn't save — check your connection") }
  }
  let tzName = ''
  try { tzName = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ') } catch { /* no Intl */ }

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs({ ...prefs, [k]: v })
  const hostCur = profile.hostCur || 'EUR'
  const homeCur = profile.homeCur || hostCur
  const diff = homeCur !== hostCur
  const version = (typeof window !== 'undefined' && (window as any).HEIMAT_VERSION) || 'V0.6'
  const germanLimits = prefs.weekCap === DEFAULT_PREFS.weekCap && prefs.yearDays === DEFAULT_PREFS.yearDays
  const canVibrate = isNative || (typeof navigator !== 'undefined' && 'vibrate' in navigator)

  const toggleNotif = async () => {
    if (notifBusy) return
    if (pushMissingInBuild) { showToast(subscribeError('android-unavailable')); return }
    if (needsInstall()) { showToast('Add Splitlife to your Home Screen first'); return }
    if (!pushSupported()) { showToast('Notifications aren’t supported on this device'); return }
    setNotifBusy(true)
    if (notif) {
      await unsubscribe(); setNotif(false); setTestMsg(null); showToast('Notifications off')
    } else {
      const r = await subscribe()
      if (r.ok) { setNotif(true); showToast('Notifications on') }
      else showToast(subscribeError(r.reason))
    }
    setNotifBusy(false)
  }
  const sendTest = async () => {
    if (testBusy) return
    setTestBusy(true); setTestMsg(null)
    setTestMsg(await sendTestNotification())
    setTestBusy(false)
  }

  const liveRate = async () => {
    setFetching(true)
    const r = await fetchRate(hostCur, homeCur)
    setFetching(false)
    if (r) { setRate(String(r).replace('.', ',')); return r }
    showToast("Couldn't reach the rate service")
    return null
  }
  const updateNow = async () => {
    const r = await liveRate()
    if (r) { sProfile({ ...profile, rate: r, rateAt: tod() }); showToast(`1 ${hostCur} = ${rateDe(r)} ${homeCur}`) }
  }
  const saveRate = () => {
    const r = numVal(rate)
    if (!r) return
    sProfile({ ...profile, rate: r, rateAt: tod() })
    setRateOpen(false); showToast('Exchange rate saved')
  }

  const exportAll = async () => {
    const data = { app: 'Heimat', exportedAt: new Date().toISOString(), profile, runway, shifts, settings: prefs }
    const r = await saveTextFile(`heimat-${tod()}.json`, JSON.stringify(data, null, 2), 'application/json')
    showToast(r === 'saved' ? 'Export saved' : r === 'copied' ? 'Export copied to clipboard' : r === 'failed' ? "Couldn't export" : 'Export ready')
  }
  const exportShifts = async () => {
    if (!shifts.length) { showToast('No shifts to export yet'); return }
    const r = await saveTextFile(`heimat-shifts-${tod()}.csv`, shiftsCsv(shifts), 'text/csv')
    showToast(r === 'saved' ? 'Shifts exported' : r === 'copied' ? 'CSV copied to clipboard' : r === 'failed' ? "Couldn't export" : 'Export ready')
  }
  /* a Splitlife export (JSON or CSV) or a timesheet from a spreadsheet; shifts already here are skipped */
  const pickImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.csv,.txt,application/json,text/csv,text/plain'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      if (f.size > 5_000_000) { showToast('That file is too big'); return }
      const r = importShifts(await f.text(), shifts)
      const note = [r.skipped && `${r.skipped} already here`, r.bad && `${r.bad} couldn't be read`].filter(Boolean).join(', ')
      if (!r.shifts.length) { showToast(note ? `Nothing new to add — ${note}` : 'No shifts found in that file'); return }
      if (!confirm(`Add ${r.shifts.length} shift${r.shifts.length === 1 ? '' : 's'}?${note ? `\n\n(${note})` : ''}`)) return
      const stamp = Date.now().toString(36)
      addShifts(r.shifts.map((s, i) => ({
        id: s.id || `${stamp}${i.toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: s.date, employer: s.employer,
        start: s.start, end: s.end, breakMin: s.breakMin, paidBreak: s.paidBreak, wage: s.wage,
        ...(s.hours != null ? { hours: s.hours } : {}), ...(s.pay != null ? { pay: s.pay } : {}),
      })))
      showToast(`Added ${r.shifts.length} shift${r.shifts.length === 1 ? '' : 's'}`)
    }
    input.click()
  }
  const clear = () => {
    if (!confirm('Clear the shifts stored on this phone?\n\nYour account, profile and groups aren\'t affected. This cannot be undone — export first if you want a copy.')) return
    clearLocal()
  }

  const notifValue = pushMissingInBuild || !pushSupported() ? 'Not available' : notif ? 'On' : 'Off'
  const sub = (title: string, body: React.ReactNode) => <Page T={T} title={title} onBack={() => setPage(null)} z={220}>{body}</Page>

  return (
    <Page T={T} title="Settings" onBack={onBack} z={210}>
      {/* your avatar, name and email — opens your profile */}
      <Group T={T}>
        <button type="button" className="h-item" onClick={onOpenProfile} style={{ gap: 14, paddingTop: 13, paddingBottom: 13 }}>
          <Avatar name={profile.name} color={profile.avatar} seed={uid || profile.name} size={56} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 19, fontWeight: 650 }}>{profile.name || 'You'}</span>
            <span style={{ display: 'block', fontSize: 13.5, color: isAnon ? T.amber : T.txt2, marginTop: 2, lineHeight: 1.4 }}>{isAnon ? 'Guest — create an account to keep your groups' : 'Profile, groups & sign-in'}</span>
          </span>
          <ChevronRight size={18} color={T.txt3} style={{ flexShrink: 0 }} />
        </button>
      </Group>

      <Group T={T}>
        <LifeSettingsItem T={T} profile={profile} sProfile={sProfile} />
      </Group>

      <Group T={T} title="Preferences">
        <div className="h-item" style={{ display: 'block', paddingTop: 13, paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
            <span className="h-item-ic" style={{ background: TINT.indigo }}><Palette size={17} /></span>
            <span style={{ fontSize: 16, fontWeight: 500 }}>Appearance</span>
          </div>
          <SegmentedControl T={T} label="Appearance" options={THEMES} value={prefs.theme} onChange={(v) => set('theme', v)} />
        </div>
        {!isNativeAndroid && <Item T={T} icon={Droplets} tint={TINT.teal} label="Reduce transparency" sub="Solid surfaces instead of glass — easier to read in bright light" right={<Toggle label="Reduce transparency" on={prefs.reduceGlass} onChange={(v) => set('reduceGlass', v)} />} />}
        <Item T={T} icon={Bell} tint={TINT.red} label="Notifications" value={notifValue} onClick={() => setPage('notif')} />
        {canVibrate && <Item T={T} icon={Vibrate} tint={TINT.pink} label="Haptic feedback" right={<Toggle label="Haptic feedback" on={prefs.haptics} onChange={(v) => set('haptics', v)} />} />}
      </Group>

      <Group T={T} title="Money & work">
        <Item T={T} icon={Globe} tint={TINT.teal} label="Currency" value={diff ? `${hostCur} → ${homeCur}` : hostCur} onClick={() => setPage('currency')} />
        {(partOn(profile, 'work') || partOn(profile, 'limit')) && <Item T={T} icon={Timer} tint={TINT.orange} label="Work limits" value={`${prefs.weekCap} h · ${prefs.yearDays} days`} onClick={() => setPage('limits')} />}
      </Group>

      <Group T={T} title="Your data">
        <Item T={T} icon={FileSpreadsheet} tint={TINT.gray} label="Export & import" sub="Your data, shifts and timesheets" onClick={() => setPage('data')} />
      </Group>

      <Group T={T} title="Legal">
        <Item T={T} icon={Shield} tint={TINT.blue} label="Privacy policy" chevron={false} right={<ExternalLink size={16} color={T.txt3} />} onClick={() => openExternal(webOrigin() + 'legal/privacy.html')} />
        <Item T={T} icon={FileText} tint={TINT.gray} label="Terms of use" chevron={false} right={<ExternalLink size={16} color={T.txt3} />} onClick={() => openExternal(webOrigin() + 'legal/terms.html')} />
        <Item T={T} icon={Info} tint={TINT.gray} label="Legal notice (Impressum)" chevron={false} right={<ExternalLink size={16} color={T.txt3} />} onClick={() => openExternal(webOrigin() + 'legal/impressum.html')} />
      </Group>

      <Group T={T} title="About" footer="Your profile and shifts stay on this phone. What you share in a group syncs only with the people in it.">
        <Item T={T} label="Version" value={`Splitlife ${version}`} />
        <Item T={T} label="Account ID" value={uid ? uid.slice(0, 8) + '…' : '—'} chevron={false} onClick={uid ? async () => { if (await copyText(uid)) showToast('Account ID copied') } : undefined} />
        <Item T={T} label="Replay intro" onClick={onReplayIntro} />
      </Group>

      {page === 'notif' && sub('Notifications', <>
        <Group T={T} footer={pushMissingInBuild ? "Notifications aren't available in this test version yet." : needsInstall() ? 'Add Splitlife to your Home Screen first.' : 'When someone adds an expense with you, settles up, reminds you, or a bill or chore is due.'}>
          <Item T={T} icon={Bell} tint={TINT.red} label="Allow notifications" right={<Toggle label="Allow notifications" on={notif} disabled={notifBusy} onChange={toggleNotif} />} />
        </Group>
        {notif && daily !== undefined && <Group T={T} footer={`“Anything to add today?” — only on days you haven't added an expense, and only while you share costs with someone. In this device's time zone${tzName ? ` (${tzName})` : ''}.`}>
          <Item T={T} icon={Clock} tint={TINT.orange} label="Daily reminder" sub="When you haven't added anything that day"
            right={<Toggle label="Daily reminder" on={daily !== null} onChange={(v) => saveDaily(v ? dailyHour : null)} />} />
          {daily !== null && <Item T={T} label="Time" right={
            <select className="fld" aria-label="Time of the daily reminder" value={dailyHour} onChange={(e) => saveDaily(Number(e.target.value))} style={{ width: 'auto', minHeight: 36, padding: '4px 10px' }}>
              {Array.from({ length: 8 }, (_, i) => 16 + i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>} />}
        </Group>}
        {/* the only way to tell "nothing has happened" from "nothing arrives" */}
        {notif && <Group T={T} footer={testMsg ? <span style={{ color: T.txt }}>{testMsg}</span> : 'Not getting any? Send one to each of your phones to check.'}>
          <Item T={T} icon={Send} tint={TINT.blue} label="Send a test notification" chevron={false} disabled={testBusy} onClick={sendTest}
            right={testBusy ? <span className="h-spin" style={{ color: T.txt3, flexShrink: 0 }} /> : undefined} />
        </Group>}
      </>)}

      {page === 'currency' && sub('Currency', <>
        <Group T={T} footer="Splitlife counts in the currency where you live, and shows your home currency beside it.">
          <Item T={T} label="Where you live" value={hostCur} onClick={onEditProfile} />
          <Item T={T} label="Home" value={homeCur} onClick={onEditProfile} />
        </Group>
        {diff && <Group T={T} title="Exchange rate" footer="Rates come from open.er-api.com and are for reference only.">
          <Item T={T} label={`1 ${hostCur} =`} sub={profile.rateAt ? `Updated ${relDay(profile.rateAt).toLowerCase()}` : 'Set by hand'} value={`${rateDe(profile.rate || 0)} ${homeCur}`} onClick={() => { setRate(String(profile.rate || '').replace('.', ',')); setRateOpen(true) }} />
          <Item T={T} label="Update daily" right={<Toggle label="Update exchange rate daily" on={prefs.autoRate} onChange={(v) => set('autoRate', v)} />} />
          <Item T={T} label={fetching ? 'Updating…' : 'Update now'} chevron={false} disabled={fetching} onClick={updateNow} />
        </Group>}
      </>)}

      {page === 'limits' && sub('Work limits', <>
        <Group T={T} footer="Germany, since March 2024: 140 full days (or 280 half days) a year, or 20 hours a week during term, for students from outside the EU. Other countries differ — check with your international office.">
          <Item T={T} icon={CalendarDays} tint={TINT.orange} label="Days per year" right={<Stepper label="days per year" value={prefs.yearDays} onChange={(v) => set('yearDays', v)} min={10} max={365} step={5} />} />
          <Item T={T} icon={Timer} tint={TINT.orange} label="Hours per week" right={<Stepper label="hours per week" value={prefs.weekCap} onChange={(v) => set('weekCap', v)} min={1} max={60} format={(n) => `${n} h`} />} />
        </Group>
        {!germanLimits && <Group T={T}><Item T={T} icon={RotateCcw} tint={TINT.gray} label="Reset to Germany's limits" chevron={false} onClick={() => setPrefs({ ...prefs, weekCap: DEFAULT_PREFS.weekCap, yearDays: DEFAULT_PREFS.yearDays })} /></Group>}
      </>)}

      {page === 'data' && sub('Export & import', <>
        <Group T={T} title="Export & import">
          <Item T={T} icon={Download} tint={TINT.blue} label="Export my data" sub="Profile and shifts as a file" onClick={exportAll} />
          {shifts.length > 0 && <Item T={T} icon={FileSpreadsheet} tint={TINT.green} label="Export shifts" sub="A spreadsheet for timesheets or your tax return" onClick={exportShifts} />}
          <Item T={T} icon={Upload} tint={TINT.orange} label="Import shifts" sub="From a Splitlife export or a timesheet (CSV)" onClick={pickImport} />
          <Item T={T} icon={Users} tint={TINT.green} label="Import from Splitwise" sub="A group with all its expenses and payments" onClick={onImportSplitwise} />
        </Group>
        <SplitwiseImports T={T} uid={uid} names={placeNames} onRemoved={onPlacesChanged} showToast={showToast} />
        <Group T={T} footer="Removes the shifts logged on this phone. Your account, profile and groups aren't affected.">
          <Item T={T} icon={Trash2} tint={TINT.red} label="Clear shifts on this phone" danger chevron={false} onClick={clear} />
        </Group>
      </>)}

      <Sheet open={rateOpen} onClose={() => setRateOpen(false)} title="Exchange rate" T={T} footer={<Btn full disabled={!numVal(rate)} onClick={saveRate}>Save rate</Btn>}>
        <Field T={T} label={`1 ${hostCur} = ? ${homeCur}`} htmlFor="st-rate" hint="Setting it by hand keeps it until the next daily update — turn off “Update daily” to keep yours.">
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="st-rate" className="fld fld-big" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            <Btn kind="secondary" size="md" icon={RefreshCw} busy={fetching} onClick={updateNow} style={{ minHeight: 56 }}>Live</Btn>
          </div>
        </Field>
      </Sheet>
    </Page>
  )
}
