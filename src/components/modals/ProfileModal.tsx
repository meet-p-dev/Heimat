import { useState, useEffect } from 'react'
import type { Theme, Profile } from '../../lib/types'
import { COUNTRIES, HOSTS } from '../../lib/data'
import { Sheet, Field, inpStyle, Flag } from '../ui'
import { numVal } from '../../lib/format'

export default function ProfileModal({ open, onClose, T, profile, sProfile, showToast, earnedTotal, spentTotal, shiftCount, fH }: {
  open: boolean; onClose: () => void; T: Theme; profile: Profile; sProfile: (p: Profile) => void
  showToast: (m: string) => void; earnedTotal: number; spentTotal: number; shiftCount: number; fH: (v: number) => string
}) {
  const [name, setName] = useState(profile.name || '')
  const [home, setHome] = useState(profile.homeCountry || COUNTRIES[0].n)
  const [host, setHost] = useState(profile.hostCountry || HOSTS[0].n)
  const [rate, setRate] = useState(String(profile.rate || ''))
  useEffect(() => { if (open) { setName(profile.name || ''); setHome(profile.homeCountry || COUNTRIES[0].n); setHost(profile.hostCountry || HOSTS[0].n); setRate(String(profile.rate || '')) } }, [open])
  const homeObj = COUNTRIES.find((c) => c.n === home) || COUNTRIES[0]
  const hostObj = HOSTS.find((c) => c.n === host) || HOSTS[0]
  const diff = homeObj.c !== hostObj.c
  const save = () => {
    sProfile({ ...profile, name: name.trim() || profile.name, homeCountry: homeObj.n, homeCur: homeObj.c, homeIso: homeObj.iso, hostCountry: hostObj.n, hostCur: hostObj.c, hostIso: hostObj.iso, rate: numVal(rate) || profile.rate })
    showToast('Profile saved'); onClose()
  }
  const Stat = ({ k, v }: { k: string; v: string }) => (
    <div style={{ flex: 1, background: T.inp, borderRadius: 14, padding: '11px 12px' }}>
      <div style={{ fontSize: 10.5, color: T.txt3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    </div>
  )
  return (
    <Sheet open={open} onClose={onClose} title="Your profile" T={T}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Stat k="Earned" v={fH(earnedTotal)} />
        <Stat k="Your spend" v={fH(spentTotal)} />
        <Stat k="Shifts" v={String(shiftCount)} />
      </div>
      <Field label="Your name" T={T}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav" style={inpStyle(T)} /></Field>
      <Field label="Home country (your currency)" T={T}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Flag iso={homeObj.iso} size={24} /><select value={home} onChange={(e) => setHome(e.target.value)} style={inpStyle(T)}>{COUNTRIES.map((c) => <option key={c.n} value={c.n}>{c.n} — {c.c}</option>)}</select></div>
      </Field>
      <Field label="Where you study (local currency)" T={T}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Flag iso={hostObj.iso} size={24} /><select value={host} onChange={(e) => setHost(e.target.value)} style={inpStyle(T)}>{HOSTS.map((c) => <option key={c.n} value={c.n}>{c.n} — {c.c}</option>)}</select></div>
      </Field>
      {diff && <Field label={`Exchange rate · 1 ${hostObj.c} = ? ${homeObj.c}`} T={T}><input value={rate} onChange={(e) => setRate(e.target.value)} type="text" inputMode="decimal" style={inpStyle(T)} /><div style={{ fontSize: 11, color: T.txt3, marginTop: 6 }}>Auto-updates when you open the app — edit to override.</div></Field>}
      <button onClick={save} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginTop: 4 }}>Save profile</button>
    </Sheet>
  )
}
