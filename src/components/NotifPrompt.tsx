import { Bell, Share } from 'lucide-react'
import type { Theme } from '../lib/types'
import { Btn } from './ui'

/* Auto-appearing "pop-up" that primes notifications. On iOS the real browser prompt
   only fires from a tap, so this card's button is what triggers it — hence a soft
   in-app prompt rather than calling Notification.requestPermission() on load. */
export default function NotifPrompt({ T, mode, busy, onEnable, onDismiss }: {
  T: Theme; mode: 'enable' | 'install'; busy: boolean; onEnable: () => void; onDismiss: () => void
}) {
  const installing = mode === 'install'
  return (
    <div className="h-layer" style={{ zIndex: 1100 }} role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="h-scrim" onClick={onDismiss} />
      <div className="h-sheet glass glass-strong" style={{ padding: '24px 20px 16px' }}>
        <div className="h-item-ic" style={{ width: 56, height: 56, borderRadius: 18, background: '#ef4444', marginBottom: 16 }}><Bell size={27} /></div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>Stay in the loop</div>
        <div style={{ fontSize: 15, color: T.txt2, lineHeight: 1.55, marginBottom: 20 }}>
          {installing
            ? <>Get a notification when a flatmate adds an expense or pays you back — even when Heimat is closed. First add Heimat to your Home Screen: tap <Share size={14} style={{ display: 'inline', verticalAlign: -2 }} /> <b>Share</b> → <b>Add to Home Screen</b>, then open it from that icon.</>
            : <>Get a notification when a flatmate adds a shared expense or records a payment to you — even when Heimat is closed.</>}
        </div>
        {installing ? (
          <Btn full onClick={onDismiss}>Got it</Btn>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Btn full busy={busy} onClick={onEnable}>Turn on notifications</Btn>
            <Btn full kind="ghost" disabled={busy} onClick={onDismiss}>Not now</Btn>
          </div>
        )}
      </div>
    </div>
  )
}
