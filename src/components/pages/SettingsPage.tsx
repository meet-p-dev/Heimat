import { useState, useEffect } from 'react'
import {
  UserPlus, LogIn, Mail, KeyRound, LogOut, Palette, Droplets, Bell, Globe, ArrowRightLeft, RefreshCw, CalendarDays, Timer, RotateCcw,
  Vibrate, Sparkles, Download, FileSpreadsheet, Trash2, Shield, FileText, Info, Fingerprint, UserX,
} from 'lucide-react'
import type { Theme, Profile, Shift, Runway, AuthMode } from '../../lib/types'
import type { Prefs, ThemeMode } from '../../lib/prefs'
import { DEFAULT_PREFS } from '../../lib/prefs'
import { fixDe, rateDe, numVal, relDay, tod } from '../../lib/format'
import { fetchRate } from '../../lib/rates'
import { pushSupported, needsInstall, isSubscribed, subscribe, unsubscribe } from '../../lib/push'
import { isNative, openExternal, webOrigin, copyText } from '../../lib/native'
import { saveTextFile, shiftsCsv } from '../../lib/exportData'
import { Page, Group, Item, Toggle, Stepper, SegmentedControl, Sheet, Field, Btn, TINT } from '../ui'

const THEMES: [ThemeMode, string][] = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']]

export default function SettingsPage({ T, prefs, setPrefs, profile, sProfile, uid, isAnon, email, pendingEmail, shifts, runway, onBack, onAuth, onSignOut, onDeleteAccount, onReplayIntro, onEditProfile, showToast, clearLocal }: {
  T: Theme; prefs: Prefs; setPrefs: (p: Prefs) => void; profile: Profile; sProfile: (p: Profile) => void
  uid: string | null; isAnon: boolean; email: string | null; pendingEmail: string | null
  shifts: Shift[]; runway: Runway | null
  onBack: () => void; onAuth: (m: AuthMode) => void; onSignOut: () => void; onDeleteAccount: () => void
  onReplayIntro: () => void; onEditProfile: () => void; showToast: (m: string) => void; clearLocal: () => void
}) {
  const [notif, setNotif] = useState(false)
  const [notifBusy, setNotifBusy] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [rate, setRate] = useState('')
  const [fetching, setFetching] = useState(false)
  useEffect(() => { isSubscribed().then(setNotif).catch(() => {}) }, [])

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs({ ...prefs, [k]: v })
  const hostCur = profile.hostCur || 'EUR'
  const homeCur = profile.homeCur || hostCur
  const diff = homeCur !== hostCur
  const version = (typeof window !== 'undefined' && (window as any).HEIMAT_VERSION) || 'V0.6'
  const germanLimits = prefs.weekCap === DEFAULT_PREFS.weekCap && prefs.yearDays === DEFAULT_PREFS.yearDays
  const canVibrate = isNative || (typeof navigator !== 'undefined' && 'vibrate' in navigator)

  const toggleNotif = async () => {
    if (notifBusy) return
    if (needsInstall()) { showToast('Add Heimat to your Home Screen first'); return }
    if (!pushSupported()) { showToast('Notifications aren’t supported on this device'); return }
    setNotifBusy(true)
    if (notif) {
      await unsubscribe(); setNotif(false); showToast('Notifications off')
    } else {
      const r = await subscribe()
      if (r.ok) { setNotif(true); showToast('Notifications on') }
      else if (r.reason === 'denied') showToast(isNative ? 'Blocked — allow Heimat in Settings → Notifications' : 'Blocked — allow notifications in your browser settings')
      else if (r.reason === 'install') showToast('Add Heimat to your Home Screen first')
      else showToast("Couldn't turn on notifications")
    }
    setNotifBusy(false)
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
  const clear = () => {
    if (!confirm('Clear the shifts and runway stored on this device?\n\nYour account, profile and flats are not affected. This cannot be undone — export first if you want a copy.')) return
    clearLocal()
  }

  return (
    <Page T={T} title="Settings" onBack={onBack} z={210}>
      <Group T={T} title="Account" footer={isAnon ? 'You are using Heimat as a guest. An account keeps your flat if you change phone or clear your browser.' : pendingEmail ? `Waiting for you to confirm ${pendingEmail}.` : undefined}>
        {isAnon ? (
          <>
            <Item T={T} icon={UserPlus} tint={TINT.green} label="Create account" sub="Free — takes 20 seconds" onClick={() => onAuth('signup')} />
            <Item T={T} icon={LogIn} tint={TINT.blue} label="Sign in" sub="Already have a Heimat account" onClick={() => onAuth('signin')} />
          </>
        ) : (
          <>
            <Item T={T} icon={Mail} tint={TINT.blue} label="Email" value={email} onClick={() => onAuth('email')} />
            <Item T={T} icon={KeyRound} tint={TINT.gray} label="Change password" onClick={() => onAuth('password')} />
            <Item T={T} icon={LogOut} tint={TINT.gray} label="Sign out" chevron={false} onClick={onSignOut} />
          </>
        )}
      </Group>

      <Group T={T} title="Appearance" footer="Reduce transparency swaps the glass for solid surfaces — easier to read in bright light, and lighter on the battery.">
        <div className="h-item" style={{ display: 'block', paddingTop: 13, paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
            <span className="h-item-ic" style={{ background: TINT.indigo }}><Palette size={17} /></span>
            <span style={{ fontSize: 16, fontWeight: 500 }}>Theme</span>
          </div>
          <SegmentedControl T={T} label="Theme" options={THEMES} value={prefs.theme} onChange={(v) => set('theme', v)} />
        </div>
        <Item T={T} icon={Droplets} tint={TINT.teal} label="Reduce transparency" right={<Toggle label="Reduce transparency" on={prefs.reduceGlass} onChange={(v) => set('reduceGlass', v)} />} />
      </Group>

      <Group T={T} title="Notifications">
        <Item T={T} icon={Bell} tint={TINT.red} label="Push notifications" sub={needsInstall() ? 'Add Heimat to your Home Screen to enable' : 'New shared expenses, list items and payments to you'}
          right={<Toggle label="Push notifications" on={notif} disabled={notifBusy} onChange={toggleNotif} />} />
      </Group>

      <Group T={T} title="Currency" footer="Rates come from open.er-api.com and are for reference only.">
        <Item T={T} icon={Globe} tint={TINT.teal} label="Currencies" value={diff ? `${hostCur} → ${homeCur}` : hostCur} onClick={onEditProfile} />
        {diff && (
          <>
            <Item T={T} icon={ArrowRightLeft} tint={TINT.gray} label="Exchange rate" sub={profile.rateAt ? `Updated ${relDay(profile.rateAt).toLowerCase()}` : 'Set by hand'} value={`${rateDe(profile.rate || 0)} ${homeCur}`} onClick={() => { setRate(String(profile.rate || '').replace('.', ',')); setRateOpen(true) }} />
            <Item T={T} icon={RefreshCw} tint={TINT.green} label="Update daily" sub="Fetch a fresh rate once a day" right={<Toggle label="Update exchange rate daily" on={prefs.autoRate} onChange={(v) => set('autoRate', v)} />} />
          </>
        )}
      </Group>

      <Group T={T} title="Work limits" footer={<>Germany: about 120 full days (or 240 half days) a year, and 20 hours a week during term. Other countries differ — check with your international office.</>}>
        <Item T={T} icon={CalendarDays} tint={TINT.orange} label="Days per year" right={<Stepper label="days per year" value={prefs.yearDays} onChange={(v) => set('yearDays', v)} min={10} max={365} step={5} />} />
        <Item T={T} icon={Timer} tint={TINT.orange} label="Hours per week" right={<Stepper label="hours per week" value={prefs.weekCap} onChange={(v) => set('weekCap', v)} min={1} max={60} format={(n) => `${n} h`} />} />
        {!germanLimits && <Item T={T} icon={RotateCcw} tint={TINT.gray} label="Reset to Germany's limits" chevron={false} onClick={() => setPrefs({ ...prefs, weekCap: DEFAULT_PREFS.weekCap, yearDays: DEFAULT_PREFS.yearDays })} />}
      </Group>

      <Group T={T} title="General">
        {canVibrate && <Item T={T} icon={Vibrate} tint={TINT.pink} label="Haptic feedback" right={<Toggle label="Haptic feedback" on={prefs.haptics} onChange={(v) => set('haptics', v)} />} />}
        <Item T={T} icon={Sparkles} tint={TINT.purple} label="Replay intro" onClick={onReplayIntro} />
      </Group>

      <Group T={T} title="Data & privacy" footer="Your profile, runway and shifts are stored only on this device. Shared flat data syncs only with your flatmates.">
        <Item T={T} icon={Download} tint={TINT.blue} label="Export my data" sub="Profile, runway and shifts as a JSON file" onClick={exportAll} />
        <Item T={T} icon={FileSpreadsheet} tint={TINT.green} label="Export shifts" sub="CSV for timesheets or your tax return" onClick={exportShifts} />
        <Item T={T} icon={Trash2} tint={TINT.red} label="Clear data on this device" sub="Removes shifts and runway" onClick={clear} />
        <Item T={T} icon={Shield} tint={TINT.gray} label="Privacy policy" onClick={() => openExternal(webOrigin() + 'legal/privacy.html')} />
        <Item T={T} icon={FileText} tint={TINT.gray} label="Terms of use" onClick={() => openExternal(webOrigin() + 'legal/terms.html')} />
      </Group>

      <Group T={T} title="About">
        <Item T={T} icon={Info} tint={TINT.gray} label="Version" value={`Heimat ${version}`} />
        <Item T={T} icon={Fingerprint} tint={TINT.gray} label="Account ID" value={uid ? uid.slice(0, 8) + '…' : '—'} chevron={false} onClick={uid ? async () => { if (await copyText(uid)) showToast('Account ID copied') } : undefined} />
      </Group>

      <Group T={T} footer="Leaves every flat and removes everything stored about you on the server. Shared expenses stay with the flat, without your name. This cannot be undone.">
        <Item T={T} icon={UserX} tint={TINT.red} label="Delete account" danger chevron={false} onClick={onDeleteAccount} />
      </Group>

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
