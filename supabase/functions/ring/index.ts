import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { handleOptions, isAllowedOrigin, jsonResponse } from '../_shared/http.ts'
import { hashSecret } from '../_shared/privacy.ts'

const allowedReasons = new Set(['Visita', 'Delivery', 'Paquete/Correo', 'Otro'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const expectedTurnstileAction = 'door_ring'

function requestIp(request: Request) {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
}

async function verifyTurnstile(token: string, secret: string, ip: string) {
  const form = new URLSearchParams({ secret, response: token })
  if (ip !== 'unknown') form.set('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
    body: form,
  })
  if (!response.ok) throw new Error(`Turnstile returned HTTP ${response.status}`)
  return await response.json() as {
    success?: boolean
    action?: string
    hostname?: string
  }
}

function isWithinQuietHours(start: string | null, end: string | null) {
  if (!start || !end) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const current = hour * 60 + minute
  const [startHour, startMinute] = start.split(':').map(Number)
  const [endHour, endMinute] = end.split(':').map(Number)
  const startTime = startHour * 60 + startMinute
  const endTime = endHour * 60 + endMinute
  if (startTime === endTime) return true
  return startTime < endTime
    ? current >= startTime && current < endTime
    : current >= startTime || current < endTime
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403, origin)
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin)

  let body: {
    slug?: unknown
    visitor_name?: unknown
    reason?: unknown
    device_id?: unknown
    turnstile_token?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  if (
    typeof body.slug !== 'string'
    || !/^[a-z0-9]{10}$/.test(body.slug)
    || typeof body.reason !== 'string'
    || !allowedReasons.has(body.reason)
    || typeof body.device_id !== 'string'
    || !uuidPattern.test(body.device_id)
    || typeof body.turnstile_token !== 'string'
    || body.turnstile_token.length < 10
    || body.turnstile_token.length > 2048
    || (body.visitor_name !== null && body.visitor_name !== undefined && typeof body.visitor_name !== 'string')
  ) {
    return jsonResponse({ error: 'invalid_request' }, 400, origin)
  }

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
  const expectedHostnames = new Set(
    (Deno.env.get('TURNSTILE_HOSTNAMES') ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  )
  const hashSalt = Deno.env.get('HASH_SALT')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!turnstileSecret || expectedHostnames.size === 0 || !hashSalt || !url || !serviceRoleKey) {
    console.error('TURNSTILE_SECRET_KEY, TURNSTILE_HOSTNAMES, HASH_SALT, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.')
    return jsonResponse({ error: 'service_not_configured' }, 500, origin)
  }

  const ip = requestIp(request)
  try {
    const result = await verifyTurnstile(body.turnstile_token, turnstileSecret, ip)
    if (
      result.success !== true
      || result.action !== expectedTurnstileAction
      || typeof result.hostname !== 'string'
      || !expectedHostnames.has(result.hostname.toLowerCase())
    ) {
      return jsonResponse({ error: 'verification_failed' }, 403, origin)
    }
  } catch (error) {
    console.error('Turnstile verification failed:', error)
    return jsonResponse({ error: 'verification_unavailable' }, 502, origin)
  }

  const [ipHash, deviceHash] = await Promise.all([
    hashSecret(ip, hashSalt),
    hashSecret(body.device_id, hashSalt),
  ])
  const cleanName = typeof body.visitor_name === 'string'
    ? body.visitor_name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || null
    : null

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: eventId, error } = await supabase.rpc('create_ring', {
    p_slug: body.slug,
    p_visitor_name: cleanName,
    p_reason: body.reason,
    p_ip_hash: ipHash,
    p_device_hash: deviceHash,
  })

  if (error) {
    if (error.message.includes('rate_limit')) return jsonResponse({ error: error.message }, 429, origin)
    if (error.message.includes('door_unavailable')) return jsonResponse({ error: 'door_unavailable' }, 404, origin)
    if (error.message.includes('invalid_reason')) return jsonResponse({ error: 'invalid_request' }, 400, origin)
    console.error('Could not create ring event:', error.message)
    return jsonResponse({ error: 'ring_failed' }, 500, origin)
  }

  const { data: door, error: doorError } = await supabase
    .from('doors')
    .select('id, owner_id, dnd_enabled, dnd_start, dnd_end, quick_replies')
    .eq('slug', body.slug)
    .maybeSingle()
  if (doorError || !door) {
    console.error('Ring event was created, but notification settings could not be loaded:', doorError?.message ?? 'door_not_found')
    return jsonResponse({ event_id: eventId, notification_sent: false }, 200, origin)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('telegram_chat_id')
    .eq('id', door.owner_id)
    .maybeSingle()
  const { data: pushSubscriptions, error: pushError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('profile_id', door.owner_id)
  const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const visitorLabel = cleanName || 'Alguien'
  const quiet = door.dnd_enabled && isWithinQuietHours(door.dnd_start, door.dnd_end)
  let notificationSent = false
  if (profileError) {
    console.error('Ring event was created, but Telegram settings could not be loaded:', profileError.message)
  } else if (profile?.telegram_chat_id && telegramToken) {
    const replies = Array.isArray(door.quick_replies)
      ? door.quick_replies.filter((reply: unknown): reply is string => typeof reply === 'string' && reply.trim().length > 0).slice(0, 4)
      : []
    const keyboard = replies.map((reply: string, index: number) => [{
      text: reply.slice(0, 60),
      callback_data: `answer:${eventId}:${index}`,
    }])
    try {
      const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: profile.telegram_chat_id,
          text: `🔔 Timbre — ${visitorLabel} (${body.reason}) · ${new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())}`,
          disable_notification: quiet,
          reply_markup: { inline_keyboard: keyboard },
        }),
      })
      const result = await telegramResponse.json() as { ok?: boolean; description?: string }
      if (!telegramResponse.ok || !result.ok) {
        console.error('Telegram notification failed:', result.description ?? `HTTP ${telegramResponse.status}`)
      } else {
        notificationSent = true
      }
    } catch (notificationError) {
      console.error('Telegram notification failed:', notificationError)
    }
  }

  if (pushError) {
    console.error('Ring event was created, but web push subscriptions could not be loaded:', pushError.message)
  } else if (pushSubscriptions?.length) {
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')
    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.error('Ring event was created, but VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are not configured.')
    } else {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
      await Promise.all(pushSubscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({
            title: `Timbre — ${visitorLabel} llegó`,
            body: `${visitorLabel} (${body.reason}) · ${new Intl.DateTimeFormat('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Argentina/Buenos_Aires',
            }).format(new Date())}`,
            url: '/panel',
            tag: `timbre-${eventId}`,
            silent: quiet,
          }), { TTL: 60 })
          notificationSent = true
        } catch (pushNotificationError) {
          const statusCode = typeof pushNotificationError === 'object'
            && pushNotificationError !== null
            && 'statusCode' in pushNotificationError
            ? pushNotificationError.statusCode
            : undefined
          console.error('Web push delivery failed:', statusCode ?? 'provider_error')
          if (statusCode === 404 || statusCode === 410) {
            const { error: removeError } = await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', subscription.endpoint)
              .eq('profile_id', door.owner_id)
            if (removeError) console.error('Could not remove expired web push subscription:', removeError.message)
          }
        }
      }))
    }
  }

  return jsonResponse({ event_id: eventId, notification_sent: notificationSent }, 200, origin)
})
