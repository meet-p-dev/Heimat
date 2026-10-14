import { useState, useEffect } from 'react'
import { isNativeAndroid } from '../lib/native'
import { Users, Clock, ChevronLeft, ArrowLeft, ShieldCheck, Cloud, Smartphone, RefreshCw, Globe, Gift, MailCheck } from 'lucide-react'
import type { Theme, Profile } from '../lib/types'
import { COUNTRIES, HOSTS, guessCountries } from '../lib/data'
import { PARTS, suggested } from '../lib/life'
import { haptic } from '../lib/haptic'
import { numVal } from '../lib/format'
import { fetchRate } from '../lib/rates'
import { openExternal, webOrigin } from '../lib/native'
import { Field, Btn, IconBtn, TINT, Card } from './ui'
import CountrySelect from './CountrySelect'
import { LifeQuestions } from './Life'

const FEATURES = [
  { Icon: Globe, tint: TINT.blue, title: 'Every amount, twice', body: "In your local currency and your home currency, at today's rate." },
  { Icon: Users, tint: TINT.green, title: 'Family, friends, WG mates', body: "Groups, bills and chores — live on everyone's phone." },
  { Icon: Clock, tint: TINT.orange, title: 'Your job, your money', body: 'Log shifts, see your pay, an estimate of the tax and your work limit.' },
  { Icon: Gift, tint: TINT.pink, title: 'Free, no limits', body: 'No ads, no tracking, no premium. As many expenses as you like.' },
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
   from the welcome screen skips the account step — they already have one. Everything that can be guessed is
   filled in (countries from the device, today's rate), so most people only confirm; an invite link that opened
   the app waits until setup is done (App.tsx, pendingLink). Same steps as ios-native/Heimat/OnboardingView.swift. */
export default function Onboarding({ T, isAnon, accountName, invited, onSignIn, onDone }: {
  T: Theme; isAnon: boolean; accountName: string | null; invited?: boolean
  onSignIn: () => void; onDone: (p: Profile, next: 'app' | 'signup') => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [guess] = useState(guessCountries)
  const [home, setHome] = useState((guess.home || COUNTRIES[0]).n)
  const [host, setHost] = useState((guess.host || HOSTS[0]).n)
  const [rate, setRate] = useState('')
  const [fetching, setFetching] = useState(false)
  const [rateFailed, setRateFailed] = useState(false)
  const [editRate, setEditRate] = useState(false)
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
    setRateFailed(false)
    const r = await fetchRate(hostObj.c, homeObj.c)
    setFetching(false)
    if (r) { setRate(String(r).replace('.', ',')); setEditRate(false) } else setRateFailed(true)
  }
  const shownRate = (Math.round((numVal(rate) || 0) * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })
  useEffect(() => { if (step === 1 && diff) { setRate(''); live() } }, [step, homeObj.c, hostObj.c])

  const draft = (): Profile => ({ name: name.trim(), homeCountry: homeObj.n, homeCur: homeObj.c, homeIso: homeObj.iso, hostCountry: hostObj.n, hostCur: hostObj.c, hostIso: hostObj.iso, rate: numVal(rate) || (diff ? 0 : 1), rateAt: undefined, onboarded: true, share, doing })

  const shell = (children: React.ReactNode, back?: () => void, progress?: number) => (
    <div className="h-page h-aurora" style={{ zIndex: 1000 }}>
      <div className="h-pagehdr" style={{ minHeight: 58 }}>
        {back ? <IconBtn label="Back" onClick={back}>{isNativeAndroid ? <ArrowLeft size={22} /> : <ChevronLeft size={23} />}</IconBtn> : <span style={{ width: 42 }} />}
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
          <p style={{ fontSize: 19, fontWeight: 650, marginTop: 8, lineHeight: 1.35 }}>Split life, not friendships.</p>
          <p style={{ fontSize: 16, color: T.txt2, marginTop: 4, lineHeight: 1.45, marginBottom: 22 }}>The free money app for life abroad.</p>
          {invited && (
            <Card T={T} style={{ padding: 14, borderRadius: 20, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="h-item-ic" style={{ background: TINT.green, width: 38, height: 38, borderRadius: 12 }}><MailCheck size={19} strokeWidth={2.2} /></span>
              <div><div style={{ fontWeight: 700, fontSize: 15.5 }}>You've been invited</div>
                <div style={{ fontSize: 13.5, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>Set up takes about a minute — then you join the group straight away.</div></div>
            </Card>
          )}
          <FeatureList T={T} />
        </div>
        <div style={{ paddingTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Btn full onClick={() => { haptic(12); setStep(1) }}>{invited ? 'Set up and join' : 'Get started'}</Btn>
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
        <p style={{ fontSize: 15, color: T.txt2, margin: '6px 0 20px', lineHeight: 1.5 }}>{diff ? `Amounts are shown in ${hostObj.c}, with ${homeObj.c} next to them.` : `Amounts are shown in ${hostObj.c}.`}</p>
        <Card T={T} style={{ padding: '18px 16px 4px', borderRadius: 26 }}>
          <Field T={T} label="What should we call you?" htmlFor="ob-name" hint="Your groups see this name."><input id="ob-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) setStep(2) }} placeholder="First name" autoComplete="given-name" autoFocus enterKeyHint="next" /></Field>
          <Field T={T} label="Where you live now" htmlFor="ob-host"><CountrySelect id="ob-host" label="Where you live now" value={host} onChange={setHost} options={HOSTS} /></Field>
          <Field T={T} label="Where you're from" htmlFor="ob-home"><CountrySelect id="ob-home" label="Where you're from" value={home} onChange={setHome} options={COUNTRIES} /></Field>
          {diff && (
            <Field T={T} label="Exchange rate" htmlFor="ob-rate" hint={rateFailed ? "Couldn't load today's rate. Type it in — or leave it empty and Splitlife fills it in once you're online." : "Today's reference rate. It updates itself once a day; change it any time in Settings."}>
              {fetching && !rate ? <div style={{ padding: '13px 2px', color: T.txt2 }}>Getting today's rate…</div>
                : rate && !editRate && !rateFailed ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px' }}>
                    <span style={{ flex: 1, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>1 {hostObj.c} = {shownRate} {homeObj.c}</span>
                    <button type="button" className="h-link" style={{ fontWeight: 650 }} onClick={() => setEditRate(true)}>Edit</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input id="ob-rate" className="fld" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="e.g. 90,5" />
                    <Btn kind="secondary" size="md" icon={RefreshCw} busy={fetching} onClick={live} style={{ minHeight: 50 }}>Live</Btn>
                  </div>
                )}
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
        {/* what these answers turn on — the same rules as Settings → Your Splitlife */}
        <div style={{ fontSize: 13, fontWeight: 650, color: T.txt2, margin: '22px 4px 8px', textTransform: 'uppercase', letterSpacing: 0.3 }}>Your Splitlife</div>
        <Card T={T} style={{ padding: '4px 16px', borderRadius: 22 }}>
          {PARTS.filter(([id]) => (id !== 'runway' || !isNativeAndroid) && suggested(id, share, doing)).map(([id, label, sub], i) => (
            <div key={id} style={{ padding: '11px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{label}</div>
              <div style={{ fontSize: 13, color: T.txt2, marginTop: 1 }}>{sub}</div>
            </div>
          ))}
        </Card>
        <div style={{ fontSize: 12.5, color: T.txt3, margin: '8px 4px 0' }}>Home and your own spending are always there. Switch any part on or off later in Settings → Your Splitlife.</div>
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
        <p style={{ fontSize: 15.5, color: T.txt2, margin: '8px 0 20px', lineHeight: 1.55 }}>A free account keeps your groups, balances and history — on any phone you sign in on.</p>
        <Card T={T} style={{ padding: '4px 16px', borderRadius: 24 }}>
          {[
            { I: Cloud, t: 'Never start over', s: 'Change phone or clear your browser, and everything is still there.' },
            { I: Smartphone, t: 'On every device', s: 'iPhone, Android or the web — the same email everywhere.' },
            { I: Users, t: 'Friends can find you', s: 'People can add you to an expense by your email.' },
          ].map(({ I, t, s }, i) => (
            <div key={t} style={{ display: 'flex', gap: 12, padding: '13px 0', borderTop: i ? `1px solid ${T.border}` : 'none' }}>
              <I size={20} color={T.acc} style={{ flexShrink: 0, marginTop: 1 }} />
              <div><div style={{ fontWeight: 650, fontSize: 15 }}>{t}</div><div style={{ fontSize: 13, color: T.txt2, marginTop: 2, lineHeight: 1.45 }}>{s}</div></div>
            </div>
          ))}
        </Card>
      </div>
      <div style={{ paddingTop: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Btn full onClick={() => { haptic(12); onDone(draft(), 'signup') }}>Create free account</Btn>
        <Btn full kind="ghost" onClick={() => onDone(draft(), 'app')}>Not now — try it first</Btn>
        <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', lineHeight: 1.5 }}>Without an account, your data lives only on this device. You can create one any time in Settings.</div>
      </div>
    </>,
    () => setStep(2),
    3,
  )
}
