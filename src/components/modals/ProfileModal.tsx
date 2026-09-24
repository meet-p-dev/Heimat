import { useState, useEffect } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import type { Theme, Profile } from '../../lib/types'
import { COUNTRIES, HOSTS } from '../../lib/data'
import { numVal, tod } from '../../lib/format'
import { fetchRate } from '../../lib/rates'
import { Sheet, Field, Btn, Avatar, AVATAR_COLORS, avatarColor } from '../ui'
import CountrySelect from '../CountrySelect'

/* edit sheet behind Profile → Edit profile (and Settings → Currencies) */
export default function ProfileModal({ open, onClose, T, profile, onSave, uid }: {
  open: boolean; onClose: () => void; T: Theme; profile: Profile; onSave: (p: Profile) => void; uid: string | null
}) {
  const [name, setName] = useState(profile.name || '')
  const [color, setColor] = useState(profile.avatar || '')
  const [home, setHome] = useState(profile.homeCountry || COUNTRIES[0].n)
  const [host, setHost] = useState(profile.hostCountry || HOSTS[0].n)
  const [rate, setRate] = useState(String(profile.rate || ''))
  const [fetching, setFetching] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(profile.name || ''); setColor(profile.avatar || ''); setHome(profile.homeCountry || COUNTRIES[0].n); setHost(profile.hostCountry || HOSTS[0].n); setRate(String(profile.rate || '').replace('.', ','))
  }, [open])
  const homeObj = COUNTRIES.find((c) => c.n === home) || COUNTRIES[0]
  const hostObj = HOSTS.find((c) => c.n === host) || HOSTS[0]
  const diff = homeObj.c !== hostObj.c
  const curChanged = homeObj.c !== profile.homeCur || hostObj.c !== profile.hostCur
  const live = async () => { setFetching(true); const r = await fetchRate(hostObj.c, homeObj.c); setFetching(false); if (r) setRate(String(r).replace('.', ',')) }
  // a new currency pair makes the old rate meaningless — fetch the right one
  useEffect(() => { if (open && diff && curChanged) live() }, [homeObj.c, hostObj.c])
  const shown = color || avatarColor(uid || name || '?')
  const save = () => {
    const r = numVal(rate)
    onSave({ ...profile, name: name.trim() || profile.name, avatar: color || undefined, homeCountry: homeObj.n, homeCur: homeObj.c, homeIso: homeObj.iso, hostCountry: hostObj.n, hostCur: hostObj.c, hostIso: hostObj.iso, rate: diff ? r || profile.rate : 1, rateAt: diff && r && r !== profile.rate ? tod() : profile.rateAt })
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Edit profile" T={T} footer={<Btn full disabled={!name.trim()} onClick={save}>Save</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <Avatar name={name || profile.name} color={shown} size={84} />
        <div role="radiogroup" aria-label="Avatar colour" style={{ display: 'flex', gap: 9, flexWrap: 'wrap', justifyContent: 'center' }}>
          {AVATAR_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={shown === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 99, background: c, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: shown === c ? `0 0 0 2px var(--bg), 0 0 0 4px ${c}` : 'inset 0 1px 0 rgba(255,255,255,.3)' }}>
              {shown === c && <Check size={15} color="#fff" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>
      <Field T={T} label="Name" htmlFor="pf-name" hint="Your flatmates see this name next to what you add."><input id="pf-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav" autoComplete="given-name" /></Field>
      <Field T={T} label="Home country" htmlFor="pf-home"><CountrySelect id="pf-home" label="Home country" value={home} onChange={setHome} options={COUNTRIES} /></Field>
      <Field T={T} label="Where you study" htmlFor="pf-host"><CountrySelect id="pf-host" label="Where you study" value={host} onChange={setHost} options={HOSTS} /></Field>
      {diff && (
        <Field T={T} label={`Exchange rate · 1 ${hostObj.c} = ? ${homeObj.c}`} htmlFor="pf-rate" style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="pf-rate" className="fld" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            <Btn kind="secondary" size="md" icon={RefreshCw} busy={fetching} onClick={live} style={{ minHeight: 50 }}>Live</Btn>
          </div>
        </Field>
      )}
    </Sheet>
  )
}
