import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Theme, Profile, Flat } from '../../lib/types'
import { COUNTRIES, HOSTS } from '../../lib/data'
import { inpStyle, Row, Flag } from '../ui'
import { numVal } from '../../lib/format'
import { pushSupported, needsInstall, getSubscription, subscribe, unsubscribe } from '../../lib/push'

export default function MeTab({ T, profile, sProfile, dark, tgDark, showToast, uid, flat, leaveFlat, onEditProfile, onReplayIntro }: {
  T: Theme; profile: Profile; sProfile: (p: Profile) => void; dark: boolean; tgDark: () => void
  showToast: (m: string) => void; uid: string | null; flat: Flat | null; leaveFlat: () => void
  onEditProfile: () => void; onReplayIntro: () => void
}) {
  const [rate, setRate] = useState(String(profile.rate || ''))
  const [notif, setNotif] = useState(false)
  const [notifBusy, setNotifBusy] = useState(false)
  useEffect(() => { getSubscription().then((s) => setNotif(!!s)) }, [])

  const toggleNotif = async () => {
    if (notifBusy) return
    if (needsInstall()) { showToast('Add Heimat to your Home Screen first'); return }
    if (!pushSupported()) { showToast('Notifications not supported on this device'); return }
    setNotifBusy(true)
    if (notif) {
      await unsubscribe(); setNotif(false); showToast('Notifications off')
    } else {
      const r = await subscribe()
      if (r.ok) { setNotif(true); showToast('Notifications on') }
      else if (r.reason === 'denied') showToast('Blocked — allow notifications in browser settings')
      else if (r.reason === 'install') showToast('Add Heimat to your Home Screen first')
      else showToast("Couldn't turn on notifications")
    }
    setNotifBusy(false)
  }
  const homeIso = profile.homeIso || COUNTRIES.find((c) => c.n === profile.homeCountry)?.iso
  const hostIso = profile.hostIso || HOSTS.find((c) => c.n === profile.hostCountry)?.iso
  const version = (typeof window !== 'undefined' && (window as any).HEIMAT_VERSION) || 'V0.6'
  return (
    <>
      <span className="h-lbl" style={{ color: T.txt3 }}>You</span>
      <div onClick={onEditProfile} className="h-press" style={{ background: `linear-gradient(135deg, ${T.accSoft}, ${T.card})`, border: `1px solid ${T.border}`, borderRadius: 20, padding: '16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
        <div style={{ width: 50, height: 50, borderRadius: 99, background: T.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 22, flexShrink: 0 }}>{(profile.name || '?')[0].toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{profile.name}</div>
          <div style={{ fontSize: 13, color: T.txt2, display: 'flex', alignItems: 'center', gap: 6 }}><Flag iso={homeIso} size={15} /> {profile.homeCountry} → {profile.hostCountry}</div>
        </div>
        <ChevronRight size={20} color={T.txt3} />
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>Currency & rate</span>
      <div style={{ background: T.card, borderRadius: 20, padding: '16px', marginBottom: 14 }}>
        <Row T={T} k="Home" v={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Flag iso={homeIso} size={15} /> {profile.homeCur}</span>} />
        <Row T={T} k="Local" v={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Flag iso={hostIso} size={15} /> {profile.hostCur}</span>} />
        {profile.homeCur !== profile.hostCur && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 12 }}>
            <span style={{ fontSize: 14, color: T.txt2, flexShrink: 0 }}>1 {profile.hostCur} =</span>
            <input value={rate} onChange={(e) => setRate(e.target.value)} type="text" inputMode="decimal" style={{ ...inpStyle(T), padding: '8px 12px' }} />
            <button onClick={() => { sProfile({ ...profile, rate: numVal(rate) || profile.rate }); showToast('Rate updated') }} className="h-press" style={{ flexShrink: 0, background: T.acc, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Save</button>
          </div>
        )}
      </div>
      <span className="h-lbl" style={{ color: T.txt3 }}>Settings</span>
      <div style={{ background: T.card, borderRadius: 20, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>Dark mode</span>
          <div onClick={tgDark} style={{ width: 46, height: 28, borderRadius: 99, background: dark ? T.acc : T.border, position: 'relative', cursor: 'pointer' }}><div style={{ position: 'absolute', top: 2, left: dark ? 20 : 2, width: 24, height: 24, borderRadius: 99, background: '#fff', transition: 'left .2s' }} /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Notifications</div>
            <div style={{ fontSize: 11, color: T.txt3, marginTop: 2 }}>
              {needsInstall() ? 'Add Heimat to your Home Screen to enable' : 'New list items & payments to you'}
            </div>
          </div>
          <div onClick={toggleNotif} style={{ flexShrink: 0, width: 46, height: 28, borderRadius: 99, background: notif ? T.acc : T.border, position: 'relative', cursor: 'pointer', opacity: notifBusy ? 0.6 : 1 }}><div style={{ position: 'absolute', top: 2, left: notif ? 20 : 2, width: 24, height: 24, borderRadius: 99, background: '#fff', transition: 'left .2s' }} /></div>
        </div>
        {flat && <div onClick={leaveFlat} className="h-press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${T.border}`, cursor: 'pointer' }}><span style={{ fontSize: 15, fontWeight: 500 }}>Leave flat “{flat.name}”</span><ChevronRight size={18} color={T.txt3} /></div>}
        <div onClick={onReplayIntro} className="h-press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer' }}><span style={{ fontSize: 15, fontWeight: 500 }}>Replay intro</span><ChevronRight size={18} color={T.txt3} /></div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: T.txt3 }}>Heimat {version} · personal data on-device · flat synced</div>
      <div style={{ textAlign: 'center', fontSize: 10, color: T.txt3, marginTop: 4, wordBreak: 'break-all' }}>id {uid ? uid.slice(0, 8) : '—'}</div>
    </>
  )
}
