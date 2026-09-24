import { Check, Home } from 'lucide-react'
import type { Theme, Flat } from '../../lib/types'
import { haptic } from '../../lib/haptic'
import { Sheet, Item, TINT } from '../ui'

export default function PickFlatModal({ open, onClose, T, myFlats, flatId, onPick }: {
  open: boolean; onClose: () => void; T: Theme; myFlats: Flat[]; flatId: string | null; onPick: (id: string) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Which flat?" T={T}>
      <div style={{ fontSize: 14, color: T.txt2, marginBottom: 12, marginTop: -4 }}>Add this shared expense to…</div>
      <div className="h-well">
        {(myFlats || []).map((f) => (
          <Item key={f.id} T={T} icon={Home} tint={TINT.green} label={f.name} sub={f.id === flatId ? 'Current flat' : undefined} chevron={false}
            right={f.id === flatId ? <Check size={18} color={T.acc} /> : undefined} onClick={() => { haptic(8); onPick(f.id) }} />
        ))}
      </div>
    </Sheet>
  )
}
