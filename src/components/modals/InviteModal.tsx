import { useState, useEffect } from 'react'
import { Share2, Copy, Link2, Trash2 } from 'lucide-react'
import type { Theme, Flat, Member } from '../../lib/types'
import { isPending } from '../../lib/types'
import { Sheet, Btn, Field, Avatar, Alert } from '../ui'
import { webOrigin, shareText, copyText } from '../../lib/native'

/* Add people to a group: by email — they don't need Heimat yet, their share counts
   from now and the email tells them where to claim it — or with the group's code. */
export default function InviteModal({ open, onClose, T, flat, members, invite, revoke, showToast }: {
  open: boolean; onClose: () => void; T: Theme; flat: Flat | null; members: Member[]
  invite: (email: string, name: string) => Promise<string | null>; revoke: (memberId: string) => void
  showToast: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [mail, setMail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setName(''); setMail(''); setErr(null) } }, [open])
  if (!flat) return null
  // inside the app shells location.origin is capacitor://localhost, so links always point at the public web address
  const url = webOrigin()
  const msg = `Join my group “${flat.name}” on Heimat\nCode: ${flat.join_code}\nOpen ${url} → tap “Join with code”.`
  const mailOK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim())
  const pending = members.filter((m) => m.flat_id === flat.id && isPending(m) && !m.left_at)
  const send = async () => {
    if (!mailOK) return
    setBusy(true); setErr(null)
    const e = await invite(mail.trim(), name.trim())
    setBusy(false)
    if (e) setErr(e); else { setName(''); setMail('') }
  }
  const share = async () => { if (await shareText(msg)) return; if (await copyText(msg)) showToast('Invite copied') }
  const linkOf = (m: Member) => (m.invite_token ? `${url}invite.html?t=${encodeURIComponent(m.invite_token)}` : null)
  return (
    <Sheet open={open} onClose={onClose} title="Add people" T={T}>
      <form onSubmit={(e) => { e.preventDefault(); send() }}>
        <Field T={T} label="Add by email" hint="They don't need Heimat yet. Their share counts from the moment you add them, and we'll email them a link to claim it — the history is waiting when they sign up.">
          <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" autoComplete="off" style={{ marginBottom: 8 }} />
          <input className="fld" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="Email" aria-label="Email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        {err && <Alert T={T}>{err}</Alert>}
        <Btn full type="submit" busy={busy} disabled={!mailOK}>Send invite</Btn>
      </form>

      {pending.length > 0 && (
        <Field T={T} label="Waiting to join" hint="Removing an invite takes them out of anything split with them, where that can be undone." style={{ marginTop: 20 }}>
          <div className="h-well">
            {pending.map((p) => {
              const state = p.invite_error ? { t: 'Not emailed', c: T.amber } : p.invite_sent_at ? { t: 'Emailed', c: T.txt3 } : p.invite_email ? { t: 'Sending…', c: T.txt3 } : { t: 'By link', c: T.txt3 }
              const link = linkOf(p)
              return (
                <div key={p.id || p.user_id} className="h-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <Avatar name={p.display_name} seed={p.user_id} size={34} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{p.display_name}</span>
                    {p.invite_email && <span style={{ display: 'block', fontSize: 12.5, color: T.txt3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.invite_email}</span>}
                    {p.invite_error && <span style={{ display: 'block', fontSize: 12, color: T.txt2, marginTop: 4 }}>{p.invite_error}</span>}
                    {(p.invite_error || !p.invite_email) && link && (
                      <span style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                        <button type="button" className="h-link" onClick={async () => { if (await copyText(link)) showToast('Invite link copied') }} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13 }}><Link2 size={14} /> Copy link</button>
                        <button type="button" className="h-link" onClick={() => shareText(link)} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 13 }}><Share2 size={14} /> Share</button>
                      </span>
                    )}
                  </span>
                  <span className="h-pill" style={{ fontSize: 11, background: `color-mix(in srgb, ${state.c} 16%, transparent)`, color: state.c }}>{state.t}</span>
                  {p.id && <button type="button" aria-label={`Remove ${p.display_name}'s invite`} onClick={() => { if (confirm('Remove this invite?')) revoke(p.id!) }} style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 2 }}><Trash2 size={16} /></button>}
                </div>
              )
            })}
          </div>
        </Field>
      )}

      <Field T={T} label="Or share a code" hint="Anyone with an account can type this in — Heimat → Join with code." style={{ marginTop: 20, marginBottom: 4 }}>
        <div className="h-well" style={{ textAlign: 'center', padding: '16px 12px 14px', borderRadius: 20, marginBottom: 10 }}>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: 6, color: T.acc, fontVariantNumeric: 'tabular-nums' }}>{flat.join_code}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn kind="secondary" size="md" icon={Share2} onClick={share} style={{ flex: 1 }}>Share</Btn>
          <Btn kind="secondary" size="md" icon={Copy} onClick={async () => { if (await copyText(flat.join_code)) showToast('Code copied') }} style={{ flex: 1 }}>Copy code</Btn>
        </div>
      </Field>
    </Sheet>
  )
}
