import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) return jsonResponse({ error: 'service_not_configured' }, 500, origin)

  let body: {
    action?: unknown
    event_id?: unknown
    call_id?: unknown
    description?: unknown
    candidate?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  if (typeof body.action !== 'string') return jsonResponse({ error: 'invalid_request' }, 400, origin)

  const authHeader = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const userResult = authHeader ? await authClient.auth.getUser(authHeader) : null
  const residentId = userResult && !userResult.error ? userResult.data.user?.id : undefined
  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

  if (body.action === 'join') {
    if (!residentId || typeof body.event_id !== 'string' || !uuidPattern.test(body.event_id)) {
      return jsonResponse({ error: 'unauthorized' }, 401, origin)
    }
    const { data: event, error: eventError } = await service
      .from('ring_events')
      .select('door_id')
      .eq('id', body.event_id)
      .maybeSingle()
    if (eventError) {
      console.error('Could not load call event:', eventError.message)
      return jsonResponse({ error: 'call_lookup_failed' }, 500, origin)
    }
    if (!event) return jsonResponse({ error: 'call_not_found' }, 404, origin)
    const { data: membership, error: membershipError } = await service
      .from('door_members')
      .select('profile_id')
      .eq('door_id', event.door_id)
      .eq('profile_id', residentId)
      .maybeSingle()
    if (membershipError) {
      console.error('Could not authorize resident call access:', membershipError.message)
      return jsonResponse({ error: 'call_access_check_failed' }, 500, origin)
    }
    if (!membership) return jsonResponse({ error: 'forbidden' }, 403, origin)
    const { data: call, error: callError } = await service
      .from('door_calls')
      .select('id, status')
      .eq('event_id', body.event_id)
      .maybeSingle()
    if (callError) {
      console.error('Could not load requested call:', callError.message)
      return jsonResponse({ error: 'call_lookup_failed' }, 500, origin)
    }
    if (!call) return jsonResponse({ error: 'call_not_found' }, 404, origin)
    return jsonResponse({ call_id: call.id, status: call.status }, 200, origin)
  }

  if (body.action === 'request') {
    if (residentId || typeof body.event_id !== 'string' || !uuidPattern.test(body.event_id)) {
      return jsonResponse({ error: 'invalid_request' }, 400, origin)
    }
    const { data: event, error: eventError } = await service
      .from('ring_events')
      .select('id, door_id, status, created_at')
      .eq('id', body.event_id)
      .maybeSingle()
    if (eventError) {
      console.error('Could not load ring event for call request:', eventError.message)
      return jsonResponse({ error: 'call_request_failed' }, 500, origin)
    }
    if (!event || event.status !== 'pending' || Date.now() - new Date(event.created_at).getTime() > 60_000) {
      return jsonResponse({ error: 'ring_event_expired' }, 410, origin)
    }
    const { data: existing, error: existingError } = await service
      .from('door_calls')
      .select('id, status')
      .eq('event_id', event.id)
      .maybeSingle()
    if (existingError) {
      console.error('Could not check existing door call:', existingError.message)
      return jsonResponse({ error: 'call_request_failed' }, 500, origin)
    }
    if (existing) return jsonResponse({ error: 'call_already_requested' }, 409, origin)

    const { data: call, error: createError } = await service
      .from('door_calls')
      .insert({ event_id: event.id, door_id: event.door_id })
      .select('id, status, expires_at')
      .single()
    if (createError) {
      console.error('Could not create door call:', createError.message)
      return jsonResponse({ error: 'call_request_failed' }, 500, origin)
    }
    const { error: notifyError } = await service
      .from('ring_events')
      .update({ call_requested: true })
      .eq('id', event.id)
    if (notifyError) {
      console.error('Call was created but could not notify resident dashboard:', notifyError.message)
      return jsonResponse({ error: 'call_notification_failed' }, 500, origin)
    }
    return jsonResponse({ call_id: call.id, status: call.status, expires_at: call.expires_at }, 200, origin)
  }

  if (typeof body.call_id !== 'string' || !uuidPattern.test(body.call_id)) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  const { data: call, error: callError } = await service
    .from('door_calls')
    .select('id, event_id, door_id, status, visitor_offer, resident_answer, visitor_candidates, resident_candidates, expires_at')
    .eq('id', body.call_id)
    .maybeSingle()
  if (callError) {
    console.error('Could not load door call:', callError.message)
    return jsonResponse({ error: 'call_lookup_failed' }, 500, origin)
  }
  if (!call) return jsonResponse({ error: 'call_not_found' }, 404, origin)

  let isVisitor = false
  if (residentId) {
    const { data: membership, error: membershipError } = await service
      .from('door_members')
      .select('profile_id')
      .eq('door_id', call.door_id)
      .eq('profile_id', residentId)
      .maybeSingle()
    if (membershipError) {
      console.error('Could not authorize door call:', membershipError.message)
      return jsonResponse({ error: 'call_access_check_failed' }, 500, origin)
    }
    if (!membership) return jsonResponse({ error: 'forbidden' }, 403, origin)
  } else {
    if (typeof body.event_id !== 'string' || body.event_id !== call.event_id) {
      return jsonResponse({ error: 'unauthorized' }, 401, origin)
    }
    isVisitor = true
  }

  if (new Date(call.expires_at).getTime() <= Date.now() && !['ended', 'rejected', 'expired'].includes(call.status)) {
    const { error: expireError } = await service
      .from('door_calls')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', call.id)
    if (expireError) console.error('Could not expire door call:', expireError.message)
    call.status = 'expired'
  }

  if (body.action === 'poll') {
    return jsonResponse({
      status: call.status,
      offer: isVisitor ? null : call.visitor_offer,
      answer: isVisitor ? call.resident_answer : null,
      candidates: isVisitor ? call.resident_candidates : call.visitor_candidates,
      expires_at: call.expires_at,
    }, 200, origin)
  }

  if (body.action === 'accept' || body.action === 'reject' || body.action === 'hangup') {
    if (isVisitor && body.action === 'accept') return jsonResponse({ error: 'forbidden' }, 403, origin)
    if (!isVisitor && body.action === 'reject' && call.status !== 'ringing') {
      return jsonResponse({ error: 'call_not_ringing' }, 409, origin)
    }
    const status = body.action === 'accept' ? 'accepted' : body.action === 'reject' ? 'rejected' : 'ended'
    const { error: updateError } = await service
      .from('door_calls')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', call.id)
      .not('status', 'in', '("ended","rejected","expired")')
    if (updateError) {
      console.error('Could not update door call status:', updateError.message)
      return jsonResponse({ error: 'call_status_update_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true, status }, 200, origin)
  }

  if (body.action === 'offer' || body.action === 'answer') {
    const expectedRole = body.action === 'offer' ? isVisitor : !isVisitor
    const description = body.description
    if (
      !expectedRole
      || typeof description !== 'object'
      || description === null
      || !('type' in description)
      || !('sdp' in description)
      || description.type !== (body.action === 'offer' ? 'offer' : 'answer')
      || typeof description.sdp !== 'string'
      || description.sdp.length > 50_000
      || call.status !== 'accepted'
    ) {
      return jsonResponse({ error: 'invalid_description' }, 400, origin)
    }
    const update = body.action === 'offer' ? { visitor_offer: description } : { resident_answer: description }
    const { error: signalError } = await service
      .from('door_calls')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', call.id)
    if (signalError) {
      console.error('Could not save WebRTC description:', signalError.message)
      return jsonResponse({ error: 'call_signal_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true }, 200, origin)
  }

  if (body.action === 'candidate') {
    if (
      typeof body.candidate !== 'object'
      || body.candidate === null
      || !('candidate' in body.candidate)
      || typeof body.candidate.candidate !== 'string'
      || body.candidate.candidate.length > 8_000
      || call.status !== 'accepted'
    ) {
      return jsonResponse({ error: 'invalid_candidate' }, 400, origin)
    }
    const field = isVisitor ? 'visitor_candidates' : 'resident_candidates'
    const existing = isVisitor ? call.visitor_candidates : call.resident_candidates
    if (!Array.isArray(existing) || existing.length >= 100) {
      return jsonResponse({ error: 'candidate_limit_reached' }, 429, origin)
    }
    const { error: candidateError } = await service
      .from('door_calls')
      .update({ [field]: [...existing, body.candidate], updated_at: new Date().toISOString() })
      .eq('id', call.id)
    if (candidateError) {
      console.error('Could not save WebRTC candidate:', candidateError.message)
      return jsonResponse({ error: 'call_signal_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true }, 200, origin)
  }

  return jsonResponse({ error: 'invalid_action' }, 400, origin)
})
