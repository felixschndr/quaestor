self.addEventListener('push', (event) => {
  let data = { title: 'Quaestor', body: '' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data) data.body = event.data.text()
  }

  const options = {
    body: data.body,
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
  }
  // A tag lets a newer notification replace an older one instead of stacking.
  if (data.tag) options.tag = data.tag
  if (data.url) options.data = { url: data.url }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if (target !== '/' && 'navigate' in client) client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
