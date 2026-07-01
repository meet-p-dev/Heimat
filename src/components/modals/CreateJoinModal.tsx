import { useState, useEffect } from 'react'
import type { Theme, Profile, ModalId } from '../../lib/types'
import { Sheet, Field, inpStyle } from '../ui'

export default function CreateJoinModal({ open, mode, onClose, T, createFlat, joinFlat, busy, profile }: {
  open: boolean; mode: ModalId; onClose: () => void; T: Theme
  createFlat: (name: string) => void; joinFlat: (code: string) => void; busy: boolean; profile: Profile
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => { if (open) { setName(profile.name ? `${profile.name}'s flat` : 'My flat'); setCode('') } }, [open, mode])
  const join = mode === 'join'
  return (
    <Sheet open={open} onClose={onClose} title={join ? 'Join a flat' : 'Create a flat'} T={T}>
      {join ? (
        <>
          <Field label="Flat code" T={T}><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 4B7K9A" style={{ ...inpStyle(T), letterSpacing: 2, fontWeight: 700, textAlign: 'center', fontSize: 20 }} /></Field>
          <button onClick={() => joinFlat(code)} disabled={busy || code.length < 4} className="h-press" style={{ width: '100%', background: code.length >= 4 ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', display: 'flex', justifyContent: 'center' }}>{busy ? <div className="h-spin" /> : 'Join flat'}</button>
          <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', marginTop: 12 }}>Ask a flatmate for the code shown in their Flat tab.</div>
        </>
      ) : (
        <>
          <Field label="Flat name" T={T}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WG Hauptstraße" style={inpStyle(T)} /></Field>
          <button onClick={() => createFlat(name)} disabled={busy} className="h-press" style={{ width: '100%', background: T.acc, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: 'pointer', display: 'flex', justifyContent: 'center' }}>{busy ? <div className="h-spin" /> : 'Create flat'}</button>
          <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', marginTop: 12 }}>You'll get a code to share with your flatmates.</div>
        </>
      )}
    </Sheet>
  )
}
