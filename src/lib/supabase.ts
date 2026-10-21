import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
    })
  : null

export type Door = {
  id: string
  owner_id: string
  name: string
  slug: string
  active: boolean
  dnd_enabled: boolean
  dnd_start: string | null
  dnd_end: string | null
  quick_replies: string[]
  created_at: string
}

export type RingEvent = {
  id: string
  door_id: string
  visitor_name: string | null
  reason: string | null
  status: 'pending' | 'answered' | 'expired'
  response_text: string | null
  created_at: string
  responded_at: string | null
  visitor_photo_path: string | null
  call_requested: boolean
}

export const defaultReplies = [
  'Ya bajo',
  'Esperá un momento',
  'No estoy, dejá el paquete',
  'No esperaba a nadie',
]

export const quickReasons = ['Visita', 'Delivery', 'Paquete/Correo', 'Otro'] as const
