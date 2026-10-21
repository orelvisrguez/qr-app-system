import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  let body: { event_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  if (typeof body.event_id !== 'string' || !uuidPattern.test(body.event_id)) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: event, error: eventError } = await service
    .from('ring_events')
    .select('door_id, visitor_photo_path')
    .eq('id', body.event_id)
    .maybeSingle()
  if (eventError) {
    console.error('Could not load visitor photo event:', eventError.message)
    return jsonResponse({ error: 'photo_lookup_failed' }, 500, origin)
  }
  if (!event?.visitor_photo_path) return jsonResponse({ error: 'photo_not_found' }, 404, origin)

  const { data: membership, error: membershipError } = await service
    .from('door_members')
    .select('profile_id')
    .eq('door_id', event.door_id)
    .eq('profile_id', userData.user.id)
    .maybeSingle()
  if (membershipError) {
    console.error('Could not authorize visitor photo access:', membershipError.message)
    return jsonResponse({ error: 'photo_access_check_failed' }, 500, origin)
  }
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403, origin)

  const { data: signedPhoto, error: signedUrlError } = await service.storage
    .from('visitor-photos')
    .createSignedUrl(event.visitor_photo_path, 300)
  if (signedUrlError || !signedPhoto) {
    console.error('Could not create visitor photo URL:', signedUrlError?.message ?? 'missing_signed_url')
    return jsonResponse({ error: 'photo_url_failed' }, 500, origin)
  }
  return jsonResponse({ url: signedPhoto.signedUrl }, 200, origin)
})
