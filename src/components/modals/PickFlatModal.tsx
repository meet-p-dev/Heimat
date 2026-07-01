import { Check } from 'lucide-react'
import type { Theme, Flat } from '../../lib/types'
import { haptic } from '../../lib/haptic'
import { Sheet } from '../ui'

export default function PickFlatModal({ open, onClose, T, myFlats, flatId, onPick }: {
  open: boolean; onClose: () => void; T: Theme; myFlats: Flat[]; flatId: string | null; onPick: (id: string) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Which flat?" T={T}>
      <div style={{ fontSize: 13, color: T.txt2, marginBottom: 12 }}>Add this shared expense to…</div>
      {(myFlats || []).map((f) => {
        const cur = f.id === flatId
        return (
          <button key={f.id} onClick={() => { haptic(8); onPick(f.id) }} className="h-press" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: T.inp, border: `1px solid ${cur ? T.acc : T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 8, cursor: 'pointer', color: T.txt }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{f.name}</span>
            {cur && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: T.acc }}><Check size={14} /> current</span>}
          </button>
        )
      })}
    </Sheet>
  )
}
