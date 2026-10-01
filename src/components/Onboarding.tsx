import { useState, useEffect } from 'react'
import { Users, FileText, Clock, ChevronLeft, ShieldCheck, Cloud, Smartphone, RefreshCw } from 'lucide-react'
import type { Theme, Profile } from '../lib/types'
import { COUNTRIES, HOSTS } from '../lib/data'
import { haptic } from '../lib/haptic'
import { numVal } from '../lib/format'
import { fetchRate } from '../lib/rates'
import { openExternal, webOrigin } from '../lib/native'
import { Field, Btn, IconBtn, TINT, Card } from './ui'
import CountrySelect from './CountrySelect'
import { LifeQuestions } from './Life'

const FEATURES = [
  { Icon: Users, tint: TINT.green, title: 'Split with anyone', body: 'Flatmates, a partner, friends — Splitlife keeps score of who owes whom, live on every phone.' },
  { Icon: FileText, tint: TINT.blue, title: 'Bills and chores, on time', body: 'Rent day, the cleaning rota, the contract to cancel — reminded, then ticked.' },
  { Icon: Clock, tint: TINT.orange, title: 'Shifts and your work limit', body: "Log shifts, see your pay and stay under a student visa's hours." },
]

/* the Splitlife "S" from the app icon, as a glass tile */
export function AppMark({ T, size = 76 }: { T: Theme; size?: number }) {
  return (
    <div className="glass" style={{ width: size, height: size, borderRadius: size * 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64" aria-hidden="true"><g fill="none" strokeWidth="5.76"><path d="M41.6 21.12A9.6 9.6 0 1 0 32 30.72" stroke={T.acc} /><path d="M32 33.28A9.6 9.6 0 1 1 22.4 42.88" stroke={T.acc} strokeOpacity={0.45} /></g></svg>
    </div>
  )
}

export function FeatureList({ T }: { T: Theme }) {
  return (
    <Card T={T} style={{ padding: '6px 16px', borderRadius: 26 }}>
      {FEATURES.map(({ Icon, tint, title, body }, i) => (
        <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
          <span className="h-item-ic" style={{ background: tint, width: 38, height: 38, borderRadius: 12 }}><Icon size={19} strokeWidth={2.2} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>{title}</div>
            <div style={{ fontSize: 13.5, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>{body}</div>
          </div>
        </div>
      ))}
    </Card>
  )
}

const Legal = ({ T }: { T: Theme }) => (
  <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', lineHeight: 1.5, marginTop: 14 }}>
    By continuing you agree to the{' '}
    <button type="button" className="h-link" style={{ fontWeight: 600 }} onClick={() => openExternal(webOrigin() + 'legal/terms.html')}>Terms</button> and{' '}
    <button type="button" className="h-link" style={{ fontWeight: 600 }} onClick={() => openExternal(webOrigin() + 'legal/privacy.html')}>Privacy policy</button>.
  </div>
)

/* First run: welcome → about you → your life (two questions) → keep it safe (account). Someone who signs in
   from the welcome screen skips the account step — they already have one. */
export default function Onboarding({ T, isAnon, accountName, onSignIn, onDone }: {
  T: Theme; isAnon: boolean; accountName: string | null
  onSignIn: () => void; onDone: (p: Profile, next: 'app' | 'signup') => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [home, setHome] = useState(COUNTRIES[0].n)
  const [host, setHost] = useState(HOSTS[0].n)
  const [rate, setRate] = useState('')
  const [fetching, setFetching] = useState(false)
  const [share, setShare] = useState<string[]>([])
  const [doing, setDoing] = useState<string[]>(['study'])
  const homeObj = COUNTRIES.find((c) => c.n === home) || COUNTRIES[0]
  const hostObj = HOSTS.find((c) => c.n === host) || HOSTS[0]
  const diff = homeObj.c !== hostObj.c

  // signing in from the welcome screen moves straight on to the profile
  useEffect(() => { if (!isAnon && step === 0) setStep(1) }, [isAnon])
  useEffect(() => { if (accountName && !name) setName(accountName) }, [accountName])

  const live = async () => {
    setFetching(true)
    const r = await fetchRate(hostObj.c, homeObj.c)
    setFetching(false)
    if (r) setRate(String(r).replace('.', ','))
  }
  useEffect(() => { if (step === 1 && diff) { setRate(''); live() } }, [step, homeObj.c, hostObj.c])

  const draft = (): Profile => ({ name: name.trim(), homeCountry: homeObj.n, homeCur: homeObj.c, homeIso: homeObj.iso, hostCountry: hostObj.n, hostCur: hostObj.c, hostIso: hostObj.iso, rate: numVal(rate) || (diff ? 0 : 1), rateAt: undefined, onboarded: true, share, doing })

  const shell = (children: React.ReactNode, back?: () => void, progress?: number) => (
    <div className="h-page h-aurora" style={{ zIndex: 1000 }}>
      <div className="h-pagehdr" style={{ minHeight: 58 }}>
        {back ? <IconBtn label="Back" onClick={back}><ChevronLeft size={23} /></IconBtn> : <span style={{ width: 42 }} />}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 6 }}>
          {progress != null && [1, 2, 3].map((i) => <span key={i} style={{ width: i === progress ? 26 : 8, height: 8, borderRadius: 99, background: i <= progress ? T.acc : T.border, transition: 'width .3s' }} />)}
        </div>
        <span style={{ width: 42 }} />
      </div>
      <div className="h-pagebody"><div className="h-pagebody-in" style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>{children}</div></div>
    </div>
  )

  if (step === 0) {
    return shell(
      <>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 8 }}>
          <AppMark T={T} />
          <h1 style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1.4, marginTop: 22, lineHeight: 1.05 }}>Splitlife</h1>
          <p style={{ fontSize: 17, color: T.txt2, marginTop: 8, lineHeight: 1.45, marginBottom: 22 }}>Bills, chores and money, shared — for life abroad.</p>
          <FeatureList T={T} />
        </div>
        <div style={{ paddingTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Btn full onClick={() => { haptic(12); setStep(1) }}>Get started</Btn>
          <Btn full kind="secondary" onClick={onSignIn}>I already have an account</Btn>
          <Legal T={T} />
        </div>
      </>,
    )
  }

  if (step === 1) {
    const ok = !!name.trim()
    return shell(
      <>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8 }}>About you</h1>
        <p style={{ fontSize: 15, color: T.txt2, margin: '6px 0 20px', lineHeight: 1.5 }}>So Splitlife can greet you and show every amount in both currencies.</p>
        <Card T={T} style={{ padding: '18px 16px 4px', borderRadius: 26 }}>
          <Field T={T} label="Your first name" htmlFor="ob-name"><input id="ob-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav" autoComplete="given-name" /></Field>
          <Field T={T} label="Home country" htmlFor="ob-home" hint={`Your home currency is ${homeObj.c}.`}><CountrySelect id="ob-home" label="Home country" value={home} onChange={setHome} options={COUNTRIES} /></Field>
          <Field T={T} label="Where you study" htmlFor="ob-host" hint={`Everyday amounts are in ${hostObj.c}.`}><CountrySelect id="ob-host" label="Where you study" value={host} onChange={setHost} options={HOSTS} /></Field>
          {diff && (
            <Field T={T} label={`Exchange rate · 1 ${hostObj.c} = ? ${homeObj.c}`} htmlFor="ob-rate" hint="A reference rate that updates itself once a day. You can change it in Settings.">
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="ob-rate" className="fld" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder={fetching ? 'Fetching…' : 'e.g. 90,5'} />
                <Btn kind="secondary" size="md" icon={RefreshCw} busy={fetching} onClick={live} style={{ minHeight: 50 }}>Live</Btn>
              </div>
            </Field>
          )}
        </Card>
        <div style={{ flex: 1 }} />
        <div style={{ paddingTop: 22 }}>
          <Btn full disabled={!ok} onClick={() => { haptic(12); setStep(2) }}>Continue</Btn>
        </div>
      </>,
      isAnon ? () => setStep(0) : undefined,
      1,
    )
  }

  if (step === 2) {
    return shell(
      <>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8 }}>Your life</h1>
        <p style={{ fontSize: 15, color: T.txt2, margin: '6px 0 20px', lineHeight: 1.5 }}>Splitlife shows only what you need. You can change it any time in Settings.</p>
        <LifeQuestions T={T} share={share} doing={doing} setShare={setShare} setDoing={setDoing} />
        <div style={{ flex: 1 }} />
        <div style={{ paddingTop: 22 }}>
          <Btn full onClick={() => { haptic(12); if (isAnon) setStep(3); else onDone(draft(), 'app') }}>{isAnon ? 'Continue' : 'Start using Splitlife'}</Btn>
        </div>
      </>,
      () => setStep(1),
      2,
    )
  }

  return shell(
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="glass" style={{ width: 68, height: 68, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.acc }}><ShieldCheck size={32} strokeWidth={1.9} /></div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, marginTop: 20 }}>Keep your data safe</h1>
        <p style={{ fontSize: 15.5, color: T.txt2, margin: '8px 0 20px', lineHeight: 1.55 }}>Create a free account and your flat, balances and history come back on any phone you sign in on.</p>
        <Card T={T} style={{ padding: '4px 16px', borderRadius: 24 }}>
          {[
            { I: Cloud, t: 'Back up your place in the flat', s: 'Change phone or clear your browser without starting over.' },
            { I: Smartphone, t: 'Use it on more than one device', s: 'Sign in with the same email everywhere.' },
          ].map(({ I, t, s }, i) => (
            <div key={t} style={{ display: 'flex', gap: 12, padding: '13px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
              <I size={20} color={T.acc} style={{ flexShrink: 0, marginTop: 1 }} />
              <div><div style={{ fontWeight: 650, fontSize: 15 }}>{t}</div><div style={{ fontSize: 13, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>{s}</div></div>
            </div>
          ))}
        </Card>
      </div>
      <div style={{ paddingTop: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Btn full onClick={() => { haptic(12); onDone(draft(), 'signup') }}>Create account</Btn>
        <Btn full kind="ghost" onClick={() => onDone(draft(), 'app')}>Continue as guest</Btn>
        <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center' }}>You can create an account any time from Settings.</div>
      </div>
    </>,
    () => setStep(2),
    3,
  )
}
