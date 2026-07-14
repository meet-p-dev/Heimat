/* Push handlers, imported into the Workbox-generated service worker (see vite.config.ts).
   Kept as a plain file because `generateSW` writes sw.js itself and leaves no room for custom code. */

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = {} }
  const title = d.title || 'Heimat'
  const options = {
    body: d.body || '',
    icon: d.icon || 'icon-192.png',
    badge: d.badge || 'icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || './' },
    vibrate: [40, 30, 40],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || './'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // focus an open Heimat tab if there is one, otherwise open a new one
      for (const c of list) {
        if ('focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
