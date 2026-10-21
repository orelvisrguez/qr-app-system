import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'

const quickReasons = ['Visita', 'Delivery', 'Paquete/Correo', 'Otro']

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  let body: { slug?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  if (typeof body.slug !== 'string' || !/^[a-z0-9]{10}$/.test(body.slug)) {
    return jsonResponse({ error: 'door_unavailable' }, 404, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.')
    return jsonResponse({ error: 'service_not_configured' }, 500, origin)
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('doors')
    .select('active')
    .eq('slug', body.slug)
    .maybeSingle()

  if (error) {
    console.error('get-door-public query failed:', error.message)
    return jsonResponse({ error: 'door_lookup_failed' }, 500, origin)
  }
  if (!data) return jsonResponse({ error: 'door_unavailable' }, 404, origin)

  return jsonResponse({ active: data.active, quick_reasons: quickReasons }, 200, origin)
})
