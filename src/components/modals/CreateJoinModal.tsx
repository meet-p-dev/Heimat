import { useState, useEffect } from 'react'
import type { Theme, Profile, ModalId } from '../../lib/types'
import { Sheet, Field, Btn } from '../ui'

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
        <form onSubmit={(e) => { e.preventDefault(); if (code.length >= 4) joinFlat(code) }}>
          <Field T={T} label="Flat code" htmlFor="cj-code" hint="Ask a flatmate — it's on their Flat tab, under the flat's name.">
            <input id="cj-code" className="fld" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="4B7K9A" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={12} style={{ letterSpacing: 6, fontWeight: 800, textAlign: 'center', fontSize: 28 }} />
          </Field>
          <Btn full type="submit" busy={busy} disabled={code.length < 4}>Join flat</Btn>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createFlat(name.trim()) }}>
          <Field T={T} label="Flat name" htmlFor="cj-name" hint="You'll get a code to share with your flatmates.">
            <input id="cj-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WG Hauptstraße" />
          </Field>
          <Btn full type="submit" busy={busy} disabled={!name.trim()}>Create flat</Btn>
        </form>
      )}
    </Sheet>
  )
}
