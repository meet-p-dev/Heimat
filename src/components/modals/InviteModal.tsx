import { useState, useEffect } from 'react'
import { Share2, Copy, Link2, Trash2 } from 'lucide-react'
import type { Theme, Flat, Member } from '../../lib/types'
import { isPending } from '../../lib/types'
import { Sheet, Btn, Field, Avatar, Alert } from '../ui'
import { webOrigin, shareText, copyText } from '../../lib/native'

/* Add people to a group: by email — they don't need Heimat yet, their share counts
   from now and the email tells them where to claim it — or with the group's code. */
export default function InviteModal({ open, onClose, T, flat, members, invite, revoke, inviteBack, showToast }: {
  open: boolean; onClose: () => void; T: Theme; flat: Flat | null; members: Member[]
  invite: (email: string, name: string) => Promise<string | null>; revoke: (memberId: string) => void
  /* someone who deleted their account: their old place as a personal link, or the reason not */
  inviteBack: (memberId: string) => Promise<{ link: string } | { error: string }>
  showToast: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [mail, setMail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backing, setBacking] = useState<string | null>(null)
  useEffect(() => { if (open) { setName(''); setMail(''); setErr(null) } }, [open])
  if (!flat) return null
  // inside the app shells location.origin is capacitor://localhost, so links always point at the public web address
  const url = webOrigin()
  // the link opens the app when it's installed, and offers it (or the browser) when it isn't
  const msg = `Join my group “${flat.name}” on Splitlife: ${url}join.html?c=${encodeURIComponent(flat.join_code)}\n(or type the code ${flat.join_code} in Splitlife → Join with code)`
  const mailOK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim())
  const pending = members.filter((m) => m.flat_id === flat.id && isPending(m) && !m.left_at)
  const gone = members.filter((m) => m.flat_id === flat.id && !!m.left_at)
  const back = async (m: Member) => {
    setBacking(m.id || null)
    const r = await inviteBack(m.id!)
    setBacking(null)
    if ('error' in r) { showToast(r.error); return }
    const text = `Come back to “${flat.name}” on Splitlife — open this and your history comes with you: ${r.link}`
    if (await shareText(text)) return
    if (await copyText(r.link)) showToast(`Link for ${m.display_name} copied`)
  }
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
        <Field T={T} label="Add by email" hint="They don't need Splitlife yet. Their share counts from the moment you add them, and we'll email them a link to claim it — the history is waiting when they sign up.">
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

      {gone.length > 0 && (
        <Field T={T} label="People who left" hint="Invite someone back and their personal link gives them their old place — expenses, payments and balance — on whatever account they open it with. Someone who still has their account can simply join again with the code." style={{ marginTop: 20 }}>
          <div className="h-well">
            {gone.map((p) => (
              <div key={p.id || p.user_id} className="h-item">
                <Avatar name={p.display_name} seed={p.user_id} size={34} />
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{p.display_name}</span>
                <Btn size="sm" kind="tinted" busy={backing === p.id} disabled={!p.id || !!backing} onClick={() => back(p)}>Invite back</Btn>
              </div>
            ))}
          </div>
        </Field>
      )}

      <Field T={T} label="Or share a code" hint="Anyone with an account can type this in — Splitlife → Join with code." style={{ marginTop: 20, marginBottom: 4 }}>
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
