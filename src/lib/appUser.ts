/* The per-app boundary on a shared account.

   Heimat and MoneyTrack sit on one auth.users, so an email and password unlock
   both. What they do NOT share is membership: public.app_users holds one row
   per (account, app), which is how each app knows an account is one of its own
   rather than a stranger who happens to have signed up next door.

   Every call fails soft. Membership is bookkeeping — losing a write must never
   cost the user a sign-in or a password reset. */
import { sb } from './supabase'

export const APP = 'heimat' as const

/* Record this account as a Heimat account, and bump the last-seen stamp.
   Anonymous sessions are devices rather than accounts, so they are skipped. */
export async function touchAppUser(displayName?: string) {
  if (!sb) return
  try {
    const { data } = await sb.auth.getUser()
    const u = data.user
    if (!u || !u.email) return
    await sb.from('app_users').upsert(
      {
        user_id: u.id,
        app: APP,
        ...(displayName ? { display_name: displayName } : {}),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,app' },
    )
  } catch {}
}

/* The name this account last used in Heimat — prefills the profile when someone
   signs in on a new device. */
export async function appUserName(): Promise<string | null> {
  if (!sb) return null
  try {
    const { data } = await sb.auth.getUser()
    if (!data.user) return null
    const { data: row } = await sb.from('app_users').select('display_name').eq('user_id', data.user.id).eq('app', APP).maybeSingle()
    return (row as { display_name?: string | null } | null)?.display_name || null
  } catch {
    return null
  }
}

/* Whether the signed-in account has ever used Heimat. Used by the reset page to
   tell a Heimat user apart from a MoneyTrack one who followed the wrong link. */
export async function isAppMember(): Promise<boolean> {
  if (!sb) return false
  try {
    const { data } = await sb.auth.getUser()
    if (!data.user) return false
    const { data: row } = await sb
      .from('app_users')
      .select('user_id')
      .eq('user_id', data.user.id)
      .eq('app', APP)
      .maybeSingle()
    return !!row
  } catch {
    return false
  }
}
