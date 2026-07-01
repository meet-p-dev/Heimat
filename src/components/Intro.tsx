import { useState } from 'react'
import { Sparkles, Home as HomeIcon } from 'lucide-react'
import type { Theme } from '../lib/types'
import { haptic } from '../lib/haptic'

const SLIDES = [
  { Icon: Sparkles, title: 'Welcome to Heimat', body: 'Your money-and-life companion as an international student abroad. Split costs with flatmates, track how long your money lasts, and stay under your work-hour limit — in your currency.' },
  { Icon: HomeIcon, title: 'How it works', body: '① Create a flat and invite flatmates with a code — shared bills sync between your phones live.\n\n② Track your funds runway and see how many months your money lasts.\n\n③ Log work shifts so you never cross the legal hour-limit.\n\nYour personal money stays on your phone. Only the shared flat is synced.' },
]

// Intro slides only — no profile/name step (used by "Replay intro")
export default function Intro({ T, onClose }: { T: Theme; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const s = SLIDES[step]
  const SIcon = s.Icon
  const last = step === SLIDES.length - 1
  return (
    <div style={{ position: 'fixed', inset: 0, background: T.bg, zIndex: 1000, display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top) + 30px) 28px calc(env(safe-area-inset-bottom) + 30px)', animation: 'hFade .3s ease' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ marginBottom: 24 }}><SIcon size={54} color={T.acc} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.8, color: T.txt, marginBottom: 16, lineHeight: 1.15 }}>{s.title}</div>
        <div style={{ fontSize: 16, color: T.txt2, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{s.body}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 22 }}>{SLIDES.map((_, i) => <div key={i} style={{ width: i === step ? 22 : 7, height: 7, borderRadius: 99, background: i === step ? T.acc : T.border, transition: 'width .25s' }} />)}</div>
      <div style={{ display: 'flex', gap: 12 }}>
        {step > 0 && <button onClick={() => setStep(step - 1)} className="h-press" style={{ flex: 1, background: T.card, color: T.txt, border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>Back</button>}
        <button onClick={() => { haptic(); last ? onClose() : setStep(step + 1) }} className="h-press" style={{ flex: 2, background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{last ? 'Got it' : 'Continue'}</button>
      </div>
    </div>
  )
}
