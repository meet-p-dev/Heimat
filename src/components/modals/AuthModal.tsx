import { useState, useEffect } from 'react'
import type { Theme } from '../../lib/types'
import { Sheet, Field, inpStyle } from '../ui'

export type AuthMode = 'save' | 'signin' | 'reset'

export default function AuthModal({ open, mode, onClose, T, busy, saveAccount, signIn, sendReset, setPassword }: {
  open: boolean; mode: AuthMode; onClose: () => void; T: Theme; busy: boolean
  saveAccount: (email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  sendReset: (email: string) => Promise<string | null>
  setPassword: (password: string) => Promise<string | null>
}) {
  const [mail, setMail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  useEffect(() => { if (open) { setMail(''); setPw(''); setErr(null); setSent(false) } }, [open, mode])

  const saving = mode === 'save'
  const resetting = mode === 'reset'
  const mailOk = /\S+@\S+\.\S+/.test(mail)
  // the reset sheet arrives with a session already, so it only asks for the new password
  const valid = resetting ? pw.length >= 6 : mailOk && pw.length >= 6

  const submit = async () => {
    if (!valid || busy) return
    setErr(null)
    const e = resetting ? await setPassword(pw) : saving ? await saveAccount(mail, pw) : await signIn(mail, pw)
    if (e) setErr(e)
    else onClose()
  }

  /* forgotten password: Supabase emails a link that opens Heimat on the web with
     a recovery session, which drops the user into this sheet in 'reset' mode */
  const forgot = async () => {
    if (busy) return
    if (!mailOk) { setErr('Enter your email address first'); return }
    setErr(null)
    const e = await sendReset(mail)
    if (e) setErr(e)
    else setSent(true)
  }

  return (
    <Sheet open={open} onClose={onClose} title={saving ? 'Save your account' : resetting ? 'Choose a new password' : 'Sign in'} T={T}>
      <div style={{ fontSize: 13, color: T.txt2, marginBottom: 14, marginTop: -4, lineHeight: 1.5 }}>
        {saving
          ? 'Add an email and password so you can get back into this account on another phone, another browser, or after clearing your data. Your flat and expenses stay exactly as they are.'
          : resetting
            ? 'You followed the reset link, so you are already signed in. Pick a new password and Heimat will remember it for next time.'
            : 'Enter the email and password you saved on your other device. Your flat, expenses and balances come back with you.'}
      </div>

      {!resetting && (
        <Field label="Email" T={T}>
          <input value={mail} onChange={(e) => setMail(e.target.value)} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" placeholder="you@example.com" style={inpStyle(T)} />
        </Field>
      )}
      <Field label={resetting ? 'New password' : 'Password'} T={T}>
        <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} type="password" autoComplete={saving || resetting ? 'new-password' : 'current-password'} placeholder="at least 6 characters" style={inpStyle(T)} />
      </Field>

      {err && <div style={{ fontSize: 13, color: T.red, marginBottom: 12 }}>{err}</div>}
      {sent && <div style={{ fontSize: 13, color: T.green, marginBottom: 12, lineHeight: 1.5 }}>Reset link sent to {mail}. Open it on this device, choose a new password, then come back and sign in.</div>}

      <button onClick={submit} disabled={!valid || busy} className="h-press" style={{ width: '100%', background: valid && !busy ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: valid && !busy ? 'pointer' : 'default', marginBottom: 8 }}>
        {busy ? 'Working…' : saving ? 'Save account' : resetting ? 'Save new password' : 'Sign in'}
      </button>

      {mode === 'signin' && (
        <button onClick={forgot} disabled={busy} className="h-press" style={{ width: '100%', background: 'none', color: T.txt2, border: 'none', borderRadius: 14, padding: '10px', fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>
          Forgot your password?
        </button>
      )}

      {saving && <div style={{ fontSize: 11, color: T.txt3, textAlign: 'center', lineHeight: 1.5 }}>Work shifts and your runway stay on this device — they aren’t part of the account.</div>}
    </Sheet>
  )
}
