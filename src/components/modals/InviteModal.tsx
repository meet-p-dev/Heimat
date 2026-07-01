import type { Theme, Flat } from '../../lib/types'
import { Sheet } from '../ui'

export default function InviteModal({ open, onClose, T, flat, showToast }: {
  open: boolean; onClose: () => void; T: Theme; flat: Flat | null; showToast: (m: string) => void
}) {
  if (!flat) return null
  const url = location.origin + location.pathname
  const msg = `Join my flat “${flat.name}” on Heimat\nCode: ${flat.join_code}\nOpen ${url} → tap “Join with a code”.`
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Heimat', text: msg }) }
      else { await navigator.clipboard.writeText(msg); showToast('Invite copied') }
    } catch {}
  }
  return (
    <Sheet open={open} onClose={onClose} title="Invite flatmates" T={T}>
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ fontSize: 12, color: T.txt2, fontWeight: 600 }}>Your flat code</div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 4, color: T.acc, margin: '6px 0 4px' }}>{flat.join_code}</div>
        <div style={{ fontSize: 13, color: T.txt3, marginBottom: 18 }}>They open Heimat → Join with a code → type this.</div>
      </div>
      <button onClick={share} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginBottom: 10 }}>Share invite</button>
      <button onClick={() => { navigator.clipboard.writeText(flat.join_code); showToast('Code copied') }} className="h-press" style={{ width: '100%', background: T.card, color: T.txt, border: `1px solid ${T.border}`, borderRadius: 16, padding: '14px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Copy code only</button>
    </Sheet>
  )
}
