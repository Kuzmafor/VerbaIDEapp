import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })
const env = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Не задан ${name}`)
  return value
}
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || (() => {
  try { return Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')).find((item) => typeof item === 'string') as string }
  catch { return '' }
})()

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
    const authorization = request.headers.get('Authorization')
    if (!authorization) return json({ message: 'Требуется авторизация.' }, 401)
    const url = env('SUPABASE_URL')
    const serverKey = serviceKey()
    if (!serverKey) throw new Error('Не задан серверный ключ Supabase.')
    const userClient = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ message: 'Сессия недействительна.' }, 401)
    const service = createClient(url, serverKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') return json({ message: 'Нужна роль администратора.' }, 403)

    if (request.method === 'GET') {
      const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) throw error
      const ids = data.users.map((item) => item.id)
      const { data: profiles, error: profilesError } = ids.length ? await service.from('profiles').select('id,is_blocked').in('id', ids) : { data: [], error: null }
      if (profilesError) throw profilesError
      const flags = new Map((profiles || []).map((item) => [item.id, item.is_blocked]))
      return json({ users: data.users.map((item) => ({
        id: item.id, email: item.email, name: item.user_metadata?.full_name || item.user_metadata?.telegram_username || '',
        username: item.user_metadata?.telegram_username || '',
        provider: item.user_metadata?.provider || item.app_metadata?.provider || 'email', createdAt: item.created_at,
        lastSignInAt: item.last_sign_in_at, isBlocked: flags.get(item.id) === true,
      })) })
    }

    if (request.method === 'PATCH') {
      const body = await request.json()
      if (!body?.userId || typeof body.isBlocked !== 'boolean') return json({ message: 'Неверные данные.' }, 400)
      if (body.userId === user.id) return json({ message: 'Нельзя ограничить собственный доступ.' }, 400)
      const { error: authError } = await service.auth.admin.updateUserById(body.userId, { ban_duration: body.isBlocked ? '876000h' : 'none' })
      if (authError) throw authError
      const { error } = await service.from('profiles').upsert({ id: body.userId, is_blocked: body.isBlocked }, { onConflict: 'id' })
      if (error) throw error
      await service.from('admin_audit_log').insert({ admin_id: user.id, target_user_id: body.userId, action: body.isBlocked ? 'block_user' : 'unblock_user' })
      return json({ ok: true })
    }
    return json({ message: 'Метод не поддерживается.' }, 405)
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : 'Ошибка панели администратора.' }, 500)
  }
})
