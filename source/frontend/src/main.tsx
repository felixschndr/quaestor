import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'

import './index.css'
import './i18n'
import { queryClient } from './lib/queryClient'
import { routeTree } from './routeTree.gen'
import { applyTheme, readStoredTheme } from './lib/theme'

// Apply the stored theme before the first paint so the user doesn't see a
// flash of the wrong colours while /auth/me is in flight.
applyTheme(readStoredTheme())

// reload the page once the new service worker has activated, so users pick up a fresh deployment automatically
registerSW({ immediate: true })

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: { queryClient },
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
