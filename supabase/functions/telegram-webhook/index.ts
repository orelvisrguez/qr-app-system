import { createClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse } from '../_shared/http.ts'
import { hashSecret } from '../_shared/privacy.ts'

type TelegramUpdate = {
  message?: {
    text?: string
    chat?: { id?: number }
  }
  callback_query?: {
    id?: string
    data?: string
    message?: { chat?: { id?: number }; message_id?: number }
  }
}

async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Telegram ${method} returned HTTP ${response.status}`)
  const result = await response.json() as { ok?: boolean; description?: string }
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${result.description ?? 'unknown error'}`)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, null)

  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  const suppliedSecret = request.headers.get('x-telegram-bot-api-secret-token')
  if (!webhookSecret || suppliedSecret !== webhookSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401, null)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const hashSalt = Deno.env.get('HASH_SALT')
  if (!url || !serviceRoleKey || !botToken || !hashSalt) {
    console.error('Telegram webhook secrets are not configured.')
    return jsonResponse({ error: 'service_not_configured' }, 500, null)
  }

  let update: TelegramUpdate
  try {
    update = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, null)
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const messageText = update.message?.text
  const chatId = update.message?.chat?.id
  if (typeof messageText === 'string' && typeof chatId === 'number') {
    if (messageText.startsWith('/start ')) {
      const rawToken = messageText.slice('/start '.length).trim()
      if (!/^[a-f0-9]{48}$/i.test(rawToken)) {
        await telegramCall(botToken, 'sendMessage', {
          chat_id: chatId,
          text: 'Ese enlace no es válido. Generá uno nuevo desde Ajustes en tu panel.',
        })
        return jsonResponse({ ok: true }, 200, null)
      }

      const tokenHash = await hashSecret(rawToken, hashSalt)
      const { data: code, error: codeError } = await supabase
        .from('telegram_link_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('token_hash', tokenHash)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .select('profile_id')
        .maybeSingle()
      if (codeError) {
        console.error('Could not validate Telegram link code:', codeError.message)
        return jsonResponse({ error: 'link_code_lookup_failed' }, 500, null)
      }
      if (!code) {
        await telegramCall(botToken, 'sendMessage', {
          chat_id: chatId,
          text: 'El enlace venció o ya fue usado. Generá uno nuevo desde Ajustes.',
        })
        return jsonResponse({ ok: true }, 200, null)
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: String(chatId) })
        .eq('id', code.profile_id)
      if (profileError) {
        console.error('Could not link Telegram profile:', profileError.message)
        return jsonResponse({ error: 'telegram_link_failed' }, 500, null)
      }
      await telegramCall(botToken, 'sendMessage', {
        chat_id: chatId,
        text: '¡Listo! Este chat ya está vinculado a tu timbre. Acá vas a recibir los avisos.',
      })
      return jsonResponse({ ok: true }, 200, null)
    }

    if (messageText === '/stop') {
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('telegram_chat_id', String(chatId))
      if (error) {
        console.error('Could not unlink Telegram chat:', error.message)
        return jsonResponse({ error: 'telegram_unlink_failed' }, 500, null)
      }
      await telegramCall(botToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Listo, este chat ya no recibirá avisos. Podés volver a vincularlo desde Ajustes.',
      })
      return jsonResponse({ ok: true }, 200, null)
    }
  }

  const callback = update.callback_query
  const callbackChatId = callback?.message?.chat?.id
  const callbackId = callback?.id
  const match = callback?.data?.match(/^answer:([0-9a-f-]{36}):([0-3])$/i)
  if (typeof callbackChatId === 'number' && callbackId && match) {
    const [, eventId, replyIndexText] = match
    const replyIndex = Number(replyIndexText)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('telegram_chat_id', String(callbackChatId))
      .maybeSingle()
    if (profileError) {
      console.error('Could not find Telegram profile:', profileError.message)
      return jsonResponse({ error: 'telegram_profile_lookup_failed' }, 500, null)
    }
    const { data: eventRow, error: eventError } = await supabase
      .from('ring_events')
      .select('id, door_id, status, doors!inner(owner_id, quick_replies)')
      .eq('id', eventId)
      .maybeSingle()
    if (eventError) {
      console.error('Could not load Telegram ring event:', eventError.message)
      return jsonResponse({ error: 'ring_event_lookup_failed' }, 500, null)
    }

    const door = eventRow?.doors as { owner_id: string; quick_replies: string[] } | undefined
    const reply = door?.quick_replies?.[replyIndex]
    if (!profile || !eventRow || door?.owner_id !== profile.id || eventRow.status !== 'pending' || !reply) {
      await telegramCall(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'Este aviso ya no está disponible.',
      })
      return jsonResponse({ ok: true }, 200, null)
    }

    const { data: updated, error: updateError } = await supabase
      .from('ring_events')
      .update({ status: 'answered', response_text: reply, responded_at: new Date().toISOString() })
      .eq('id', eventId)
      .eq('status', 'pending')
      .select('id')
    if (updateError) {
      console.error('Could not answer Telegram ring event:', updateError.message)
      return jsonResponse({ error: 'ring_event_update_failed' }, 500, null)
    }
    if (!updated?.length) {
      await telegramCall(botToken, 'answerCallbackQuery', {
        callback_query_id: callbackId,
        text: 'Este aviso ya fue respondido.',
      })
      return jsonResponse({ ok: true }, 200, null)
    }

    await telegramCall(botToken, 'answerCallbackQuery', { callback_query_id: callbackId, text: reply })
    const messageId = callback.message?.message_id
    if (typeof messageId === 'number') {
      await telegramCall(botToken, 'editMessageReplyMarkup', {
        chat_id: callbackChatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      })
    }
    return jsonResponse({ ok: true }, 200, null)
  }

  return jsonResponse({ ok: true }, 200, null)
})
