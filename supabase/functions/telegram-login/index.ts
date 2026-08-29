// Telegram OIDC → Supabase Auth. Этот код запускается только в Supabase Edge
// Function: Client Secret и service_role никогда не попадают в GitHub Pages/APK.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6'

const telegramIssuer = 'https://oauth.telegram.org'
const jwks = createRemoteJWKSet(new URL(`${telegramIssuer}/.well-known/jwks.json`))
const encoder = new TextEncoder()

const env = (key: string) => {
  const value = Deno.env.get(key)
  if (!value) throw new Error(`Не задан секрет ${key}`)
  return value
}

const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (c) => c.charCodeAt(0))

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))))
}

const nativeReturnUrl = 'verbaide://auth'

async function createState(returnTo: string) {
  const verifier = b64(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
  const body = b64(encoder.encode(JSON.stringify({ verifier, returnTo, expiresAt: Date.now() + 10 * 60_000 })))
  return { state: `${body}.${await hmac(body, env('TELEGRAM_STATE_SECRET'))}`, challenge }
}

async function readState(value: string | null) {
  const [body, signature] = String(value || '').split('.')
  if (!body || !signature || signature !== await hmac(body, env('TELEGRAM_STATE_SECRET'))) throw new Error('Сессия входа недействительна. Попробуйте ещё раз.')
  const payload = JSON.parse(new TextDecoder().decode(unb64(body)))
  if (!payload.verifier || payload.expiresAt < Date.now()) throw new Error('Время входа истекло. Начните заново.')
  return payload as { verifier: string, returnTo: string }
}

const callbackUrl = () => `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/telegram-login`
const appUrl = () => env('APP_REDIRECT_URL')
const redirectError = (message: string, returnTo = appUrl()) => Response.redirect(`${returnTo}#telegram_error=${encodeURIComponent(message)}`, 302)
const serviceKey = () => {
  // Старые проекты получают SERVICE_ROLE_KEY напрямую. В новых проектах
  // Supabase хранит именованные secret keys как JSON-карту.
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')
  if (legacy) return legacy
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const first = Object.values(keys)[0]
    if (typeof first === 'string' && first) return first
  } catch { /* описание ошибки ниже понятнее */ }
  throw new Error('Не найден серверный ключ Supabase для создания сессии.')
}

Deno.serve(async (request) => {
  try {
    const requestUrl = new URL(request.url)
    const clientId = env('TELEGRAM_CLIENT_ID')
    if (requestUrl.searchParams.get('action') === 'start') {
      const returnTo = requestUrl.searchParams.get('return_to') === nativeReturnUrl ? nativeReturnUrl : appUrl()
      const { state, challenge } = await createState(returnTo)
      const telegramUrl = new URL(`${telegramIssuer}/auth`)
      telegramUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl(),
        response_type: 'code',
        scope: 'openid profile',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString()
      return Response.redirect(telegramUrl, 302)
    }

    const code = requestUrl.searchParams.get('code')
    const state = await readState(requestUrl.searchParams.get('state'))
    if (!code) throw new Error('Telegram не вернул код входа.')

    const tokenResponse = await fetch(`${telegramIssuer}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, client_id: clientId,
        client_secret: env('TELEGRAM_CLIENT_SECRET'), redirect_uri: callbackUrl(), code_verifier: state.verifier,
      }),
    })
    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok || !tokens.id_token) throw new Error(tokens.error_description || 'Telegram не подтвердил вход.')

    const verified = await jwtVerify(tokens.id_token, jwks, { audience: clientId, issuer: telegramIssuer })
    const telegramId = String(verified.payload.sub || '')
    if (!telegramId) throw new Error('Telegram не вернул идентификатор пользователя.')

    const displayName = String(verified.payload.name || [verified.payload.given_name, verified.payload.family_name].filter(Boolean).join(' ') || 'Пользователь Telegram')
    const username = String(verified.payload.preferred_username || verified.payload.username || '')
    const avatarUrl = String(verified.payload.picture || '')
    const admin = createClient(env('SUPABASE_URL'), serviceKey(), { auth: { autoRefreshToken: false, persistSession: false } })
    const generated = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: `telegram-${telegramId}@telegram.verbaide.local`,
      options: { redirectTo: state.returnTo },
    })
    if (generated.error || !generated.data.properties?.action_link) throw new Error(generated.error?.message || 'Не удалось создать сессию VerbaIDE.')
    if (generated.data.user?.id) {
      const current = generated.data.user.user_metadata || {}
      await admin.auth.admin.updateUserById(generated.data.user.id, {
        user_metadata: {
          ...current,
          provider: 'telegram', telegram_id: telegramId, telegram_username: username,
          full_name: displayName, avatar_url: avatarUrl,
        },
      })
    }
    return Response.redirect(generated.data.properties.action_link, 302)
  } catch (error) {
    return redirectError(error instanceof Error ? error.message : 'Не удалось выполнить вход через Telegram.')
  }
})
