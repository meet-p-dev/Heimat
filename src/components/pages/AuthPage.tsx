import { useState, useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'
import { UserPlus, LogIn, KeyRound, LockKeyhole, Mail, MailCheck, AlertCircle, ShieldAlert } from 'lucide-react'
import type { Theme, AuthMode } from '../../lib/types'
import { Btn, Field, PasswordInput, Page, Card, Alert } from '../ui'
import { openExternal, webOrigin } from '../../lib/native'

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* 0 too short · 1 okay · 2 good · 3 strong */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0
  let s = 0
  if (pw.length >= 12) s++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^a-zA-Z0-9]/.test(pw)) s++
  return s <= 1 ? 1 : s === 2 ? 2 : 3
}

const COPY: Record<AuthMode, { icon: LucideIcon; title: string; cta: string }> = {
  signup: { icon: UserPlus, title: 'Create your account', cta: 'Create account' },
  signin: { icon: LogIn, title: 'Welcome back', cta: 'Sign in' },
  forgot: { icon: KeyRound, title: 'Reset your password', cta: 'Send reset link' },
  reset: { icon: LockKeyhole, title: 'Choose a new password', cta: 'Save new password' },
  password: { icon: LockKeyhole, title: 'Change password', cta: 'Update password' },
  email: { icon: Mail, title: 'Change email', cta: 'Send confirmation link' },
}

/* Every account screen in one place: sign up, sign in, forgotten password, the
   reset that a recovery link opens, and changing password or email. An account is
   the current (anonymous) user with an email and password attached, so signing
   up keeps the same user id — and with it the flat and every expense. */
export default function AuthPage({ T, mode, setMode, onClose, busy, isAnon, inFlat, email, defaultName, signUp, signIn, sendReset, setPassword, changeEmail }: {
  T: Theme; mode: AuthMode; setMode: (m: AuthMode) => void; onClose: () => void; busy: boolean
  isAnon: boolean; inFlat: boolean; email: string | null; defaultName?: string
  signUp: (name: string, email: string, password: string) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<string | null>
  sendReset: (email: string) => Promise<string | null>
  setPassword: (password: string) => Promise<string | null>
  changeEmail: (email: string) => Promise<string | null>
}) {
  const [name, setName] = useState(defaultName || '')
  const [mail, setMail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [cool, setCool] = useState(0)
  // the email carries across sign in ↔ sign up ↔ forgot; the password never does
  useEffect(() => { setPw(''); setErr(null); setSent(false) }, [mode])
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(cool - 1), 1000); return () => clearTimeout(t) }, [cool])

  const c = COPY[mode]
  const mailOk = MAIL_RE.test(mail.trim())
  const newPw = mode === 'signup' || mode === 'reset' || mode === 'password'
  const strength = passwordStrength(pw)
  const valid =
    mode === 'signup' ? !!name.trim() && mailOk && pw.length >= 8
    : mode === 'signin' ? mailOk && pw.length > 0
    : mode === 'forgot' ? mailOk
    : mode === 'email' ? mailOk && mail.trim().toLowerCase() !== (email || '').toLowerCase()
    : pw.length >= 8

  const submit = async () => {
    if (!valid || busy) return
    setErr(null)
    const m = mail.trim()
    let e: string | null = null
    if (mode === 'signup') e = await signUp(name.trim(), m, pw)
    else if (mode === 'signin') e = await signIn(m, pw)
    else if (mode === 'forgot') e = await sendReset(m)
    else if (mode === 'email') e = await changeEmail(m)
    else e = await setPassword(pw)
    if (e) { setErr(e); return }
    if (mode === 'forgot' || mode === 'email') { setSent(true); setCool(60) }
    else onClose()
  }

  const sub =
    mode === 'signup' ? 'Your flat, balances and history — backed up, and back on any phone you sign in on.'
    : mode === 'signin' ? 'Sign in to get your flat and balances back on this device.'
    : mode === 'forgot' ? "Enter the email you signed up with and we'll send you a link to choose a new password."
    : mode === 'reset' ? "You followed the reset link, so you're already signed in. Choose a new password for next time."
    : mode === 'password' ? `Signed in as ${email || 'your account'}. Choose a new password — at least 8 characters.`
    : `Currently ${email || 'no email'}. We'll send a link to the new address; the change takes effect once you open it.`

  const meter = newPw && pw.length > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '9px 4px 0' }} aria-live="polite">
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {[1, 2, 3].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: strength >= i ? [T.red, T.amber, T.acc, T.green][strength] : T.border, transition: 'background .25s' }} />)}
      </div>
      <span style={{ fontSize: 12, fontWeight: 650, color: [T.red, T.amber, T.acc, T.green][strength], minWidth: 64, textAlign: 'right' }}>{['Too short', 'Okay', 'Good', 'Strong'][strength]}</span>
    </div>
  )

  const Icon = sent ? MailCheck : c.icon

  return (
    <Page T={T} title="" onBack={onClose} close z={1200}>
      <div style={{ maxWidth: 420, margin: '0 auto', paddingTop: 6 }}>
        <div className="glass" style={{ width: 66, height: 66, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.acc }}><Icon size={30} strokeWidth={1.9} /></div>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.9, marginTop: 18 }}>{sent ? (mode === 'forgot' ? 'Check your inbox' : 'Confirm your new email') : c.title}</h1>
        <p style={{ fontSize: 15.5, color: T.txt2, margin: '8px 0 20px', lineHeight: 1.55 }}>
          {sent
            ? mode === 'forgot'
              ? <>If an account exists for <b style={{ color: T.txt }}>{mail.trim()}</b>, a reset link is on its way. Open it, choose a new password, then come back and sign in.</>
              : <>Open the link we sent to <b style={{ color: T.txt }}>{mail.trim()}</b>. Until then, keep signing in with {email}.</>
            : sub}
        </p>

        {sent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mode === 'forgot' ? <Btn full onClick={() => setMode('signin')}>Back to sign in</Btn> : <Btn full onClick={onClose}>Done</Btn>}
            <Btn full kind="ghost" disabled={cool > 0 || busy} onClick={submit}>{cool > 0 ? `Resend in ${cool}s` : 'Resend email'}</Btn>
            <div style={{ fontSize: 12.5, color: T.txt3, textAlign: 'center', lineHeight: 1.5, marginTop: 4 }}>Nothing after a few minutes? Check your spam folder.</div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
            {mode === 'signin' && isAnon && inFlat && (
              <Alert T={T} tone="amber"><ShieldAlert size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>You're in a flat as a guest. Signing in to another account leaves this guest session behind. To keep it, <button type="button" className="h-link" style={{ color: 'inherit', textDecoration: 'underline' }} onClick={() => setMode('signup')}>create an account</button> instead.</span></Alert>
            )}
            {err && <Alert T={T}><AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /><span>{err}</span></Alert>}

            <Card T={T} style={{ padding: '18px 16px 2px', borderRadius: 26, marginBottom: 16 }}>
              {mode === 'signup' && <Field T={T} label="Name" htmlFor="au-name"><input id="au-name" className="fld" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder="What flatmates call you" /></Field>}
              {(mode === 'signup' || mode === 'signin' || mode === 'forgot' || mode === 'email') && (
                <Field T={T} label={mode === 'email' ? 'New email' : 'Email'} htmlFor="au-mail" error={mail.trim() && !mailOk && mail.includes('@') && mail.includes('.') ? "That email address doesn't look right." : undefined}>
                  <input id="au-mail" className="fld" value={mail} onChange={(e) => setMail(e.target.value)} type="email" inputMode="email" autoComplete={mode === 'signin' ? 'username' : 'email'} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" />
                </Field>
              )}
              {mode !== 'forgot' && mode !== 'email' && (
                <Field T={T} label={newPw ? (mode === 'signup' ? 'Password' : 'New password') : 'Password'} htmlFor="au-pw">
                  <PasswordInput id="au-pw" value={pw} onChange={setPw} autoComplete={newPw ? 'new-password' : 'current-password'} placeholder={newPw ? 'At least 8 characters' : 'Your password'} />
                  {meter}
                  {mode === 'signin' && <div style={{ textAlign: 'right', marginTop: 10 }}><button type="button" className="h-link" style={{ fontSize: 13.5 }} onClick={() => setMode('forgot')}>Forgot password?</button></div>}
                </Field>
              )}
            </Card>

            <Btn full type="submit" busy={busy} disabled={!valid}>{c.cta}</Btn>

            {mode === 'signup' && <div style={{ fontSize: 14, color: T.txt2, textAlign: 'center', marginTop: 18 }}>Already have an account? <button type="button" className="h-link" onClick={() => setMode('signin')}>Sign in</button></div>}
            {mode === 'signin' && isAnon && <div style={{ fontSize: 14, color: T.txt2, textAlign: 'center', marginTop: 18 }}>New to Heimat? <button type="button" className="h-link" onClick={() => setMode('signup')}>Create an account</button></div>}
            {mode === 'forgot' && <div style={{ fontSize: 14, color: T.txt2, textAlign: 'center', marginTop: 18 }}>Remembered it? <button type="button" className="h-link" onClick={() => setMode('signin')}>Back to sign in</button></div>}
            {mode === 'signup' && (
              <div style={{ fontSize: 12, color: T.txt3, textAlign: 'center', lineHeight: 1.55, marginTop: 14 }}>
                By creating an account you agree to the{' '}
                <button type="button" className="h-link" style={{ fontWeight: 600 }} onClick={() => openExternal(webOrigin() + 'legal/terms.html')}>Terms</button> and{' '}
                <button type="button" className="h-link" style={{ fontWeight: 600 }} onClick={() => openExternal(webOrigin() + 'legal/privacy.html')}>Privacy policy</button>. Shifts and your runway stay on this device — they aren't part of the account.
              </div>
            )}
          </form>
        )}
      </div>
    </Page>
  )
}
