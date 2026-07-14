import { Bell, Share } from 'lucide-react'
import type { Theme } from '../lib/types'

/* Auto-appearing "pop-up" that primes notifications. On iOS the real browser prompt
   only fires from a tap, so this card's button is what triggers it — hence a soft
   in-app prompt rather than calling Notification.requestPermission() on load. */
export default function NotifPrompt({ T, mode, busy, onEnable, onDismiss }: {
  T: Theme; mode: 'enable' | 'install'; busy: boolean; onEnable: () => void; onDismiss: () => void
}) {
  const installing = mode === 'install'
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,.5)', animation: 'hFade .2s ease' }} onClick={onDismiss}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, margin: 12, marginBottom: 'calc(env(safe-area-inset-bottom) + 12px)', background: T.card, borderRadius: 22, padding: '22px 20px 18px', boxShadow: '0 12px 40px rgba(0,0,0,.4)', animation: 'hSheet .3s cubic-bezier(.22,1,.36,1)' }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, background: T.accSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.acc, marginBottom: 14 }}>
          <Bell size={26} />
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, marginBottom: 6 }}>Stay in the loop</div>
        <div style={{ fontSize: 14, color: T.txt2, lineHeight: 1.55, marginBottom: 18 }}>
          {installing
            ? <>Get a notification when a flatmate adds an expense or pays you back — even when Heimat is closed. To turn it on, first add Heimat to your Home Screen: tap <Share size={13} style={{ display: 'inline', verticalAlign: -1 }} /> <b>Share</b> → <b>Add to Home Screen</b>, then open it from that icon.</>
            : <>Get a notification when a flatmate adds a shared expense or records a payment to you — even when Heimat is closed.</>}
        </div>
        {installing ? (
          <button onClick={onDismiss} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 14, padding: '14px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Got it</button>
        ) : (
          <>
            <button onClick={onEnable} disabled={busy} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 14, padding: '14px', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer', marginBottom: 8, opacity: busy ? 0.6 : 1 }}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>
            <button onClick={onDismiss} disabled={busy} className="h-press" style={{ width: '100%', background: 'none', color: T.txt2, border: 'none', borderRadius: 14, padding: '12px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Not now</button>
          </>
        )}
      </div>
    </div>
  )
}
