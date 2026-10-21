import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'
import { hashSecret } from '../_shared/privacy.ts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const hashSalt = Deno.env.get('HASH_SALT')
  if (!accessToken || !url || !anonKey || !serviceRoleKey || !hashSalt) {
    return jsonResponse({ error: 'service_not_configured' }, 500, origin)
  }

  const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: userData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !userData.user) return jsonResponse({ error: 'unauthorized' }, 401, origin)

  let body: { action?: unknown; door_id?: unknown; email?: unknown; token?: unknown; invite_id?: unknown; profile_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  const service = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  if (body.action === 'accept') {
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/i.test(body.token) || !userData.user.email) {
      return jsonResponse({ error: 'invalid_invite' }, 400, origin)
    }
    const tokenHash = await hashSecret(body.token, hashSalt)
    const { data: doorId, error: acceptError } = await service.rpc('accept_door_invite', {
      p_token_hash: tokenHash,
      p_profile_id: userData.user.id,
      p_email: userData.user.email,
    })
    if (acceptError?.message.includes('invite_invalid_or_expired')) {
      return jsonResponse({ error: 'invite_invalid_or_expired' }, 403, origin)
    }
    if (acceptError || typeof doorId !== 'string') {
      console.error('Could not accept door invitation:', acceptError?.message ?? 'missing_door_id')
      return jsonResponse({ error: 'invite_accept_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true, door_id: doorId }, 200, origin)
  }

  if (typeof body.door_id !== 'string' || !uuidPattern.test(body.door_id)) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }
  const doorId = body.door_id
  const { data: membership, error: membershipError } = await service
    .from('door_members')
    .select('role')
    .eq('door_id', doorId)
    .eq('profile_id', userData.user.id)
    .maybeSingle()
  if (membershipError) {
    console.error('Could not check door membership:', membershipError.message)
    return jsonResponse({ error: 'membership_lookup_failed' }, 500, origin)
  }
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403, origin)

  if (body.action === 'list') {
    const { data: members, error: membersError } = await service
      .from('door_members')
      .select('profile_id, role, created_at')
      .eq('door_id', doorId)
      .order('created_at')
    if (membersError) {
      console.error('Could not list door residents:', membersError.message)
      return jsonResponse({ error: 'member_list_failed' }, 500, origin)
    }
    const residentDetails = await Promise.all((members ?? []).map(async (member) => {
      const { data, error } = await service.auth.admin.getUserById(member.profile_id)
      if (error) console.error('Could not load resident email:', error.message)
      return { ...member, email: error ? null : data.user?.email ?? null }
    }))
    const { data: invites, error: invitesError } = await service
      .from('door_invites')
      .select('id, email, expires_at, created_at')
      .eq('door_id', doorId)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    if (invitesError) {
      console.error('Could not list door invitations:', invitesError.message)
      return jsonResponse({ error: 'invite_list_failed' }, 500, origin)
    }
    return jsonResponse({ members: residentDetails, invites: invites ?? [], role: membership.role }, 200, origin)
  }

  if (body.action === 'invite') {
    if (membership.role !== 'owner') return jsonResponse({ error: 'forbidden' }, 403, origin)
    if (typeof body.email !== 'string' || body.email.length > 254 || !emailPattern.test(body.email.trim())) {
      return jsonResponse({ error: 'invalid_email' }, 400, origin)
    }
    const email = body.email.trim().toLowerCase()
    const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const tokenHash = await hashSecret(rawToken, hashSalt)
    const { data: invite, error: createError } = await service
      .from('door_invites')
      .insert({
        door_id: doorId,
        email,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_by: userData.user.id,
      })
      .select('id, email, expires_at')
      .single()
    if (createError) {
      console.error('Could not create door invitation:', createError.message)
      return jsonResponse({ error: 'invite_create_failed' }, 500, origin)
    }
    return jsonResponse({ invite: { ...invite, url: `${origin}/invitacion/${rawToken}` } }, 200, origin)
  }

  if (body.action === 'revoke-invite') {
    if (membership.role !== 'owner' || typeof body.invite_id !== 'string' || !uuidPattern.test(body.invite_id)) {
      return jsonResponse({ error: 'forbidden' }, 403, origin)
    }
    const { error } = await service
      .from('door_invites')
      .delete()
      .eq('id', body.invite_id)
      .eq('door_id', doorId)
      .is('used_at', null)
    if (error) {
      console.error('Could not revoke door invitation:', error.message)
      return jsonResponse({ error: 'invite_revoke_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true }, 200, origin)
  }

  if (body.action === 'remove-member') {
    if (typeof body.profile_id !== 'string' || !uuidPattern.test(body.profile_id)) {
      return jsonResponse({ error: 'invalid_request' }, 400, origin)
    }
    if (body.profile_id !== userData.user.id && membership.role !== 'owner') {
      return jsonResponse({ error: 'forbidden' }, 403, origin)
    }
    const { data: target, error: targetError } = await service
      .from('door_members')
      .select('role')
      .eq('door_id', doorId)
      .eq('profile_id', body.profile_id)
      .maybeSingle()
    if (targetError) {
      console.error('Could not inspect door member:', targetError.message)
      return jsonResponse({ error: 'member_lookup_failed' }, 500, origin)
    }
    if (!target || target.role === 'owner') return jsonResponse({ error: 'owner_cannot_be_removed' }, 409, origin)
    const { error } = await service
      .from('door_members')
      .delete()
      .eq('door_id', doorId)
      .eq('profile_id', body.profile_id)
    if (error) {
      console.error('Could not remove door resident:', error.message)
      return jsonResponse({ error: 'member_remove_failed' }, 500, origin)
    }
    return jsonResponse({ ok: true }, 200, origin)
  }

  return jsonResponse({ error: 'invalid_action' }, 400, origin)
})
