import { Home as HomeIcon } from 'lucide-react'
import type { Theme, ModalId } from '../../lib/types'

export default function NoFlat({ T, setModal, authErr, uid }: { T: Theme; setModal: (m: ModalId) => void; authErr: string | null; uid: string | null }) {
  return (
    <div style={{ padding: '20px 4px' }}>
      <div style={{ textAlign: 'center', marginBottom: 22, marginTop: 10 }}>
        <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><HomeIcon size={46} color={T.acc} strokeWidth={1.5} /></div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>Your shared flat</div>
        <div style={{ fontSize: 14, color: T.txt2, marginTop: 6, lineHeight: 1.5 }}>Create a flat and invite your flatmates, or join one with a code. Shared bills sync between your phones live.</div>
      </div>
      <button onClick={() => setModal('create')} disabled={!uid} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 700, cursor: uid ? 'pointer' : 'default', marginBottom: 12, opacity: uid ? 1 : 0.5 }}>+ Create a flat</button>
      <button onClick={() => setModal('join')} disabled={!uid} className="h-press" style={{ width: '100%', background: T.card, color: T.txt, border: `1px solid ${T.border}`, borderRadius: 16, padding: '16px', fontSize: 16, fontWeight: 700, cursor: uid ? 'pointer' : 'default', opacity: uid ? 1 : 0.5 }}>Join with a code</button>
      {/* someone reinstalling or on a new phone lands here — let them get their old flat back */}
      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <span style={{ fontSize: 13, color: T.txt2 }}>Been here before? </span>
        <button onClick={() => setModal('signin')} disabled={!uid} style={{ background: 'none', border: 'none', color: T.acc, fontSize: 13, fontWeight: 700, cursor: uid ? 'pointer' : 'default', padding: 0 }}>Sign in</button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: authErr ? T.amber : T.txt3, marginTop: 16 }}>{authErr ? "Can't reach the server — check your connection." : uid ? 'Connected ✓' : 'Connecting…'}</div>
    </div>
  )
}
