// Edge Function: zarządzanie użytkownikami przez admina.
// Weryfikuje, że wywołujący jest adminem (RPC is_admin), a operacje wykonuje kluczem
// service-role (tylko po stronie serwera — nigdy w bundlu przeglądarki).
// Deploy: przez Supabase MCP / CLI. verify_jwt = true.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
    const { data: isAdmin } = await userClient.rpc('is_admin')
    if (!isAdmin) return json({ error: 'forbidden: nie jesteś adminem' }, 403)

    const admin = createClient(url, service)
    const body = await req.json().catch(() => ({}))
    const action = body.action

    if (action === 'list') {
      const { data, error } = await admin.auth.admin.listUsers()
      if (error) throw error
      const { data: admins } = await admin.from('app_admins').select('user_id')
      const adminIds = new Set((admins ?? []).map((a: { user_id: string }) => a.user_id))
      return json({
        users: data.users.map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          is_admin: adminIds.has(u.id),
        })),
      })
    }

    if (action === 'create') {
      const { email, password, is_admin } = body
      if (!email || !password) return json({ error: 'email i hasło są wymagane' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) throw error
      if (is_admin && data.user) await admin.from('app_admins').upsert({ user_id: data.user.id })
      return json({ user: { id: data.user?.id, email: data.user?.email } })
    }

    if (action === 'delete') {
      const { id } = body
      if (!id) return json({ error: 'id jest wymagane' }, 400)
      if (id === user.id) return json({ error: 'nie możesz usunąć samego siebie' }, 400)
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'nieznana akcja' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
