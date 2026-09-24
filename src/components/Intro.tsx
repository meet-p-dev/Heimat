import { Lock } from 'lucide-react'
import type { Theme } from '../lib/types'
import { haptic } from '../lib/haptic'
import { Btn, IconBtn } from './ui'
import { AppMark, FeatureList } from './Onboarding'
import { X } from 'lucide-react'

// the welcome screen again, without the profile steps (Settings → Replay intro)
export default function Intro({ T, onClose }: { T: Theme; onClose: () => void }) {
  return (
    <div className="h-page h-aurora" style={{ zIndex: 1000 }}>
      <div className="h-pagehdr"><span style={{ flex: 1 }} /><IconBtn label="Close" onClick={onClose}><X size={20} /></IconBtn></div>
      <div className="h-pagebody">
        <div className="h-pagebody-in" style={{ maxWidth: 460 }}>
          <AppMark T={T} />
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1.1, marginTop: 20 }}>Welcome to Heimat</h1>
          <p style={{ fontSize: 16, color: T.txt2, margin: '8px 0 20px', lineHeight: 1.5 }}>Your money-and-life companion as an international student — in your currency.</p>
          <FeatureList T={T} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, color: T.txt2, margin: '18px 6px 24px', lineHeight: 1.5 }}>
            <Lock size={16} color={T.acc} style={{ flexShrink: 0, marginTop: 2 }} />
            Your runway, shifts and profile stay on this phone. Only the shared flat is synced, and only with your flatmates.
          </div>
          <Btn full onClick={() => { haptic(); onClose() }}>Got it</Btn>
        </div>
      </div>
    </div>
  )
}
