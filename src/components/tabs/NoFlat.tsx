import { Users, Plus, KeyRound } from 'lucide-react'
import type { Theme, ModalId } from '../../lib/types'
import { Card, Btn, EmptyState } from '../ui'

export default function NoFlat({ T, setModal, authErr, uid, isAnon, onSignIn }: {
  T: Theme; setModal: (m: ModalId) => void; authErr: string | null; uid: string | null; isAnon: boolean; onSignIn: () => void
}) {
  return (
    <Card T={T} grad style={{ borderRadius: 28, padding: '18px 18px 20px' }}>
      <EmptyState T={T} icon={Users} title="Your shared flat" body="Create a flat and invite your flatmates, or join theirs with a code. Shared bills sync between your phones live.">
        <Btn full icon={Plus} disabled={!uid} onClick={() => setModal('create')}>Create a flat</Btn>
        <Btn full kind="secondary" icon={KeyRound} disabled={!uid} onClick={() => setModal('join')}>Join with a code</Btn>
      </EmptyState>
      {/* someone reinstalling or on a new phone lands here — let them get their old flat back */}
      {isAnon && <div style={{ textAlign: 'center', fontSize: 14, color: T.txt2, marginTop: 14 }}>Been here before? <button type="button" className="h-link" disabled={!uid} onClick={onSignIn}>Sign in</button></div>}
      <div style={{ textAlign: 'center', fontSize: 12.5, color: authErr ? T.amber : T.txt3, marginTop: 14 }}>{authErr ? "Can't reach the server — check your connection." : uid ? 'Connected' : 'Connecting…'}</div>
    </Card>
  )
}
