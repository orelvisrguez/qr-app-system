const CACHE_NAME = 'timbre-shell-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        return cached || (request.mode === 'navigate' ? caches.match('/') : Response.error())
      }),
  )
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data?.json() ?? {}
  } catch {
    message = { body: event.data?.text() ?? '' }
  }

  const title = typeof message.title === 'string' ? message.title : 'Timbre — Alguien llegó'
  const options = {
    body: typeof message.body === 'string' ? message.body : 'Tenés un nuevo aviso en tu puerta.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: typeof message.tag === 'string' ? message.tag : 'timbre-ring',
    data: { url: typeof message.url === 'string' ? message.url : '/panel' },
    silent: message.silent === true,
    vibrate: message.silent === true ? undefined : [180, 80, 180],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url ?? '/panel', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : new URL('/panel', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(url)
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
