import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/* Heimat and MoneyTrack share one Supabase project and, on GitHub Pages, one
   origin — so they also share localStorage. A session stored under the default
   key ("sb-<ref>-auth-token") is therefore a key either app could claim. Heimat
   names its own, so the two sign-ins can never overwrite one another.

   The rename has to carry the existing session across: most Heimat users are
   anonymous, and an anonymous session that is dropped is an account that is
   gone — with it the flat, its expenses and its balances. Copy first, then let
   the client take over the new key. */
const STORAGE_KEY = 'heimat-auth'
function adoptLegacySession() {
  if (typeof localStorage === 'undefined' || !url) return
  try {
    if (localStorage.getItem(STORAGE_KEY)) return
    const ref = new URL(url).hostname.split('.')[0]
    const legacy = localStorage.getItem(`sb-${ref}-auth-token`)
    if (legacy) localStorage.setItem(STORAGE_KEY, legacy)
  } catch {}
}
adoptLegacySession()

export const sb =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // the emailed recovery link comes back as a URL fragment; picking it up
          // is what turns the link into a session the reset page can act on
          detectSessionInUrl: true,
          storageKey: STORAGE_KEY,
        },
      })
    : null
