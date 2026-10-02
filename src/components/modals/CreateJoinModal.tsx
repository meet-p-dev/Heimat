import { useState, useEffect } from 'react'
import type { Theme, Profile, ModalId } from '../../lib/types'
import { Sheet, Field, Btn } from '../ui'

export default function CreateJoinModal({ open, mode, onClose, T, createFlat, joinFlat, busy, profile, initialCode }: {
  open: boolean; mode: ModalId; onClose: () => void; T: Theme
  createFlat: (name: string) => void; joinFlat: (code: string) => void; busy: boolean; profile: Profile
  /* from a group's invite link — filled in, still joined only with a tap */
  initialCode?: string
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  useEffect(() => { if (open) { setName(''); setCode(initialCode || '') } }, [open, mode])
  const join = mode === 'join'
  return (
    <Sheet open={open} onClose={onClose} title={join ? 'Join a group' : 'New group'} T={T}>
      {join ? (
        <form onSubmit={(e) => { e.preventDefault(); if (code.length >= 4) joinFlat(code) }}>
          <Field T={T} label="Group code" htmlFor="cj-code" hint="Ask someone in the group — it's on the group's page, under its name. Been in this group before and deleted your account? Ask someone in it to invite you back instead, so your history comes with you.">
            <input id="cj-code" className="fld" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="4B7K9A" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={12} style={{ letterSpacing: 6, fontWeight: 800, textAlign: 'center', fontSize: 28 }} />
          </Field>
          <Btn full type="submit" busy={busy} disabled={code.length < 4}>Join group</Btn>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createFlat(name.trim()) }}>
          <Field T={T} label="Group name" htmlFor="cj-name" hint="Your flat, a trip, a team — anyone you split with. Invite them with the code or by email; they don't need a Splitlife account first.">
            <input id="cj-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WG Hauptstraße, Sicily trip" />
          </Field>
          <Btn full type="submit" busy={busy} disabled={!name.trim()}>Create group</Btn>
        </form>
      )}
    </Sheet>
  )
}
