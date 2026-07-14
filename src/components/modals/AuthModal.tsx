import { useState, useEffect } from 'react'
import type { Theme } from '../../lib/types'
import { Sheet, Field, inpStyle } from '../ui'

export type AuthMode = 'save' | 'signin'

export default function AuthModal({ open, mode, onClose, T, busy, saveAccount, signIn }: {
  open: boolean; mode: AuthMode; onClose: () => void; T: Theme; busy: boolean
  saveAccount: (email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
}) {
  const [mail, setMail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setMail(''); setPw(''); setErr(null) } }, [open, mode])

  const saving = mode === 'save'
  const valid = /\S+@\S+\.\S+/.test(mail) && pw.length >= 6

  const submit = async () => {
    if (!valid || busy) return
    setErr(null)
    const e = saving ? await saveAccount(mail, pw) : await signIn(mail, pw)
    if (e) setErr(e)
    else onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={saving ? 'Save your account' : 'Sign in'} T={T}>
      <div style={{ fontSize: 13, color: T.txt2, marginBottom: 14, marginTop: -4, lineHeight: 1.5 }}>
        {saving
          ? 'Add an email and password so you can get back into this account on another phone, another browser, or after clearing your data. Your flat and expenses stay exactly as they are.'
          : 'Enter the email and password you saved on your other device. Your flat, expenses and balances come back with you.'}
      </div>

      <Field label="Email" T={T}>
        <input value={mail} onChange={(e) => setMail(e.target.value)} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" placeholder="you@example.com" style={inpStyle(T)} />
      </Field>
      <Field label="Password" T={T}>
        <input value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} type="password" autoComplete={saving ? 'new-password' : 'current-password'} placeholder="at least 6 characters" style={inpStyle(T)} />
      </Field>

      {err && <div style={{ fontSize: 13, color: T.red, marginBottom: 12 }}>{err}</div>}

      <button onClick={submit} disabled={!valid || busy} className="h-press" style={{ width: '100%', background: valid && !busy ? T.acc : T.border, color: '#fff', border: 'none', borderRadius: 16, padding: '16px', fontWeight: 700, fontSize: 16, cursor: valid && !busy ? 'pointer' : 'default', marginBottom: 8 }}>
        {busy ? 'Working…' : saving ? 'Save account' : 'Sign in'}
      </button>

      {saving && <div style={{ fontSize: 11, color: T.txt3, textAlign: 'center', lineHeight: 1.5 }}>Work shifts and your runway stay on this device — they aren’t part of the account.</div>}
    </Sheet>
  )
}
