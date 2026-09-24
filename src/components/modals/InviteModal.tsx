import { Share2, Copy } from 'lucide-react'
import type { Theme, Flat } from '../../lib/types'
import { Sheet, Btn } from '../ui'
import { webOrigin, shareText, copyText } from '../../lib/native'

export default function InviteModal({ open, onClose, T, flat, showToast }: {
  open: boolean; onClose: () => void; T: Theme; flat: Flat | null; showToast: (m: string) => void
}) {
  if (!flat) return null
  // inside the app shells location.origin is capacitor://localhost, so the
  // invite always points at the public web address instead
  const url = webOrigin()
  const msg = `Join my flat “${flat.name}” on Heimat\nCode: ${flat.join_code}\nOpen ${url} → tap “Join with a code”.`
  const share = async () => {
    if (await shareText(msg)) return
    if (await copyText(msg)) showToast('Invite copied')
  }
  const copyCode = async () => { if (await copyText(flat.join_code)) showToast('Code copied') }
  return (
    <Sheet open={open} onClose={onClose} title="Invite flatmates" T={T}>
      <div className="h-well" style={{ textAlign: 'center', padding: '20px 12px 18px', borderRadius: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: T.txt2, fontWeight: 600 }}>Code for {flat.name}</div>
        <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 6, color: T.acc, margin: '6px 0 4px', fontVariantNumeric: 'tabular-nums' }}>{flat.join_code}</div>
        <div style={{ fontSize: 13.5, color: T.txt3, lineHeight: 1.5 }}>They open Heimat → Join with a code → type this.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Btn full icon={Share2} onClick={share}>Share invite</Btn>
        <Btn full kind="secondary" icon={Copy} onClick={copyCode}>Copy code only</Btn>
      </div>
    </Sheet>
  )
}
