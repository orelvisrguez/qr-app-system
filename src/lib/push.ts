const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function isPushSupported() {
  return Boolean(
    'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window,
  )
}

export function getPushPublicKey() {
  return vapidPublicKey
}

export function decodeVapidPublicKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}
