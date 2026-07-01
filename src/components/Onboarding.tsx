import { useState, useEffect } from 'react'
import { Sparkles, Home as HomeIcon } from 'lucide-react'
import type { Theme, Profile, Country } from '../lib/types'
import { COUNTRIES, HOSTS } from '../lib/data'
import { haptic } from '../lib/haptic'
import { Field, inpStyle, Flag } from './ui'

export default function Onboarding({ T, onDone }: { T: Theme; onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [home, setHome] = useState(COUNTRIES[0].n)
  const [host, setHost] = useState(HOSTS[0].n)
  const [rate, setRate] = useState('')
  const [fetching, setFetching] = useState(false)
  const homeObj: Country = COUNTRIES.find((c) => c.n === home) || COUNTRIES[0]
  const hostObj: Country = HOSTS.find((c) => c.n === host) || HOSTS[0]

  const fetchRate = async () => {
    setFetching(true)
    try {
      const r = await fetch(`https://open.er-api.com/v6/latest/${hostObj.c}`)
      const d = await r.json()
      const v = d && d.rates && d.rates[homeObj.c]
      if (v) setRate(String(Math.round(v * 100) / 100))
    } catch {}
    setFetching(false)
  }
  useEffect(() => { if (step === 2 && !rate && homeObj.c !== hostObj.c) fetchRate() }, [step])

  const slides = [
    { Icon: Sparkles, title: 'Welcome to Heimat', body: 'Your money-and-life companion as an international student abroad. Split costs with flatmates, track how long your money lasts, and stay under your work-hour limit — in your currency.' },
    { Icon: HomeIcon, title: 'How it works', body: '① Create a flat and invite flatmates with a code — shared bills sync between your phones live.\n\n② Track your funds runway and see how many months your money lasts.\n\n③ Log work shifts so you never cross the legal hour-limit.\n\nYour personal money stays on your phone. Only the shared flat is synced.' },
  ]

  if (step < 2) {
    const s = slides[step]
    const SIcon = s.Icon
    return (
      <div style={{ position: 'fixed', inset: 0, background: T.bg, zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 30px) 28px calc(env(safe-area-inset-bottom) + 30px)', animation: 'hFade .3s ease' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ marginBottom: 24 }}><SIcon size={54} color={T.acc} strokeWidth={1.5} /></div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, color: T.txt, marginBottom: 16, lineHeight: 1.15 }}>{s.title}</div>
          <div style={{ fontSize: 16, color: T.txt2, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{s.body}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 22 }}>{[0, 1, 2].map((i) => <div key={i} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 99, background: i === step ? T.acc : T.border, transition: 'width .25s' }} />)}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {step > 0 && <button onClick={() => setStep(step - 1)} className="h-press" style={{ flex: 1, background: T.card, color: T.txt, border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Back</button>}
          <button onClick={() => { haptic(); setStep(step + 1) }} className="h-press" style={{ flex: 2, background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Continue</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: T.bg, zIndex: 1000, display: 'flex', flexDirection: 'column', animation: 'hFade .3s ease' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top) + 24px) 24px 8px' }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, color: T.txt }}>Set up your profile</div>
        <div style={{ fontSize: 14, color: T.txt2, marginTop: 4 }}>So Heimat shows every amount in both currencies.</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        <Field label="Your name" T={T}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav" style={inpStyle(T)} /></Field>
        <Field label="Home country (your currency)" T={T}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Flag iso={homeObj.iso} size={24} />
            <select value={home} onChange={(e) => setHome(e.target.value)} style={inpStyle(T)}>{COUNTRIES.map((c) => <option key={c.n} value={c.n}>{c.n} — {c.c}</option>)}</select>
          </div>
        </Field>
        <Field label="Where you study (local currency)" T={T}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Flag iso={hostObj.iso} size={24} />
            <select value={host} onChange={(e) => setHost(e.target.value)} style={inpStyle(T)}>{HOSTS.map((c) => <option key={c.n} value={c.n}>{c.n} — {c.c}</option>)}</select>
          </div>
        </Field>
        {homeObj.c !== hostObj.c && (
          <Field label={`Exchange rate · 1 ${hostObj.c} = ? ${homeObj.c}`} T={T}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" inputMode="decimal" placeholder="rate" style={inpStyle(T)} />
              <button onClick={fetchRate} className="h-press" style={{ flexShrink: 0, background: T.card, color: T.acc, border: `1px solid ${T.border}`, borderRadius: 12, padding: '0 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{fetching ? '…' : 'Live rate'}</button>
            </div>
            <div style={{ fontSize: 11, color: T.txt3, marginTop: 6 }}>Reference rate only — edit anytime in the Me tab.</div>
          </Field>
        )}
      </div>
      <div style={{ padding: '8px 24px calc(env(safe-area-inset-bottom) + 24px)' }}>
        <button disabled={!name.trim()} onClick={() => { haptic(14); onDone({ name: name.trim(), homeCountry: homeObj.n, homeCur: homeObj.c, homeIso: homeObj.iso, hostCountry: hostObj.n, hostCur: hostObj.c, hostIso: hostObj.iso, rate: parseFloat(rate) || (homeObj.c === hostObj.c ? 1 : 0), onboarded: true }) }} className="h-press" style={{ width: '100%', background: name.trim() ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default' }}>Start using Heimat</button>
      </div>
    </div>
  )
}
