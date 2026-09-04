// Deletes the calling user's account. Required by App Store guideline 5.1.1(v) —
// an app that can create an account has to be able to delete one — and it is how
// a GDPR erasure request is honoured in-app.
//
// The flat's shared history (expenses, settlements, list items) belongs to the
// whole flat and stays, but nothing in it points at the deleted person any more:
// the created_by/added_by columns are ON DELETE SET NULL, so the app falls back
// to showing "Someone".
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    // who is asking — read it from their own token, never from the request body
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: whoErr } = await asUser.auth.getUser()
    if (whoErr || !user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

    await admin.from('push_subscriptions').delete().eq('user_id', user.id)
    await admin.from('flat_members').delete().eq('user_id', user.id)

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
    if (delErr) {
      console.error('deleteUser failed', delErr)
      return json({ error: 'delete failed' }, 500)
    }

    return json({ ok: true })
  } catch (e) {
    console.error(e)
    return json({ error: 'error' }, 500)
  }
})
