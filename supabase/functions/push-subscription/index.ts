import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'

type PushSubscriptionBody = {
  action?: unknown
  subscription?: {
    endpoint?: unknown
    keys?: {
      p256dh?: unknown
      auth?: unknown
    }
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!accessToken || !url || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'unauthorized' }, 401, origin)
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: userData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !userData.user) return jsonResponse({ error: 'unauthorized' }, 401, origin)

  let body: PushSubscriptionBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  const endpoint = body.subscription?.endpoint
  const p256dh = body.subscription?.keys?.p256dh
  const auth = body.subscription?.keys?.auth
  if (
    (body.action !== 'subscribe' && body.action !== 'unsubscribe')
    || typeof endpoint !== 'string'
    || endpoint.length > 2048
    || typeof p256dh !== 'string'
    || p256dh.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(p256dh)
    || typeof auth !== 'string'
    || auth.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(auth)
  ) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(endpoint)
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  const hostname = parsedEndpoint.hostname.toLowerCase()
  const isKnownPushService = hostname === 'fcm.googleapis.com'
    || hostname === 'web.push.apple.com'
    || hostname === 'push.services.mozilla.com'
    || hostname.endsWith('.push.services.mozilla.com')
  if (
    parsedEndpoint.protocol !== 'https:'
    || parsedEndpoint.username
    || parsedEndpoint.password
    || (parsedEndpoint.port && parsedEndpoint.port !== '443')
    || !isKnownPushService
  ) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  const serviceClient = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  if (body.action === 'unsubscribe') {
    const { error } = await serviceClient
      .from('push_subscriptions')
      .delete()
      .eq('profile_id', userData.user.id)
      .eq('endpoint', endpoint)
    if (error) {
      console.error('Could not remove web push subscription:', error.message)
      return jsonResponse({ error: 'subscription_remove_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true }, 200, origin)
  }

  const { error: insertError } = await serviceClient.from('push_subscriptions').insert({
    profile_id: userData.user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
  })
  if (!insertError) return jsonResponse({ ok: true }, 200, origin)

  if (insertError.code !== '23505') {
    console.error('Could not save web push subscription:', insertError.message)
    return jsonResponse({ error: 'subscription_save_failed' }, 500, origin)
  }

  const { data: existing, error: lookupError } = await serviceClient
    .from('push_subscriptions')
    .select('id, profile_id')
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (lookupError) {
    console.error('Could not check existing web push subscription:', lookupError.message)
    return jsonResponse({ error: 'subscription_lookup_failed' }, 500, origin)
  }
  if (!existing || existing.profile_id !== userData.user.id) {
    return jsonResponse({ error: 'subscription_in_use' }, 409, origin)
  }

  const { error: updateError } = await serviceClient
    .from('push_subscriptions')
    .update({
      p256dh,
      auth,
      user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    })
    .eq('id', existing.id)
  if (updateError) {
    console.error('Could not refresh web push subscription:', updateError.message)
    return jsonResponse({ error: 'subscription_save_failed' }, 500, origin)
  }
  return jsonResponse({ ok: true }, 200, origin)
})
