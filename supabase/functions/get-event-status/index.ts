import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  let body: { event_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  if (typeof body.event_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.event_id)) {
    return jsonResponse({ error: 'event_not_found' }, 404, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.')
    return jsonResponse({ error: 'service_not_configured' }, 500, origin)
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('ring_events')
    .select('status, response_text, created_at')
    .eq('id', body.event_id)
    .maybeSingle()

  if (error) {
    console.error('get-event-status query failed:', error.message)
    return jsonResponse({ error: 'event_lookup_failed' }, 500, origin)
  }
  if (!data) return jsonResponse({ error: 'event_not_found' }, 404, origin)

  if (data.status === 'pending' && Date.now() - new Date(data.created_at).getTime() >= 60_000) {
    const { error: expireError } = await supabase
      .from('ring_events')
      .update({ status: 'expired' })
      .eq('id', body.event_id)
      .eq('status', 'pending')
    if (expireError) {
      console.error('Could not expire ring event:', expireError.message)
      return jsonResponse({ error: 'event_update_failed' }, 500, origin)
    }
    return jsonResponse({ status: 'expired', response_text: null }, 200, origin)
  }

  return jsonResponse({ status: data.status, response_text: data.response_text }, 200, origin)
})
