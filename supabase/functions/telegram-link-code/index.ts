import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'
import { hashSecret } from '../_shared/privacy.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  const authorization = request.headers.get('authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const hashSalt = Deno.env.get('HASH_SALT')
  const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '')
  if (!accessToken || !url || !anonKey || !serviceRoleKey || !hashSalt || !botUsername) {
    console.error('Telegram linking requires an authenticated user and configured Supabase and Telegram secrets.')
    return jsonResponse({ error: 'service_not_configured' }, 500, origin)
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: userData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !userData.user) return jsonResponse({ error: 'unauthorized' }, 401, origin)

  const serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const tokenHash = await hashSecret(rawToken, hashSalt)
  const { error: cleanupError } = await serviceClient
    .from('telegram_link_codes')
    .delete()
    .eq('profile_id', userData.user.id)
  if (cleanupError) {
    console.error('Could not replace Telegram link codes:', cleanupError.message)
    return jsonResponse({ error: 'link_code_failed' }, 500, origin)
  }

  const { error: insertError } = await serviceClient.from('telegram_link_codes').insert({
    profile_id: userData.user.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (insertError) {
    console.error('Could not create Telegram link code:', insertError.message)
    return jsonResponse({ error: 'link_code_failed' }, 500, origin)
  }

  return jsonResponse({
    link_url: `https://t.me/${encodeURIComponent(botUsername)}?start=${rawToken}`,
    expires_in_seconds: 600,
  }, 200, origin)
})
