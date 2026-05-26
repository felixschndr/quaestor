import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

// __root.tsx imports devtools that pull in the full TanStack Router runtime.
// Stub the bits we don't need so the route module imports cleanly under jsdom.
vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  createRootRouteWithContext: () => () => ({}),
}))
vi.mock('@tanstack/react-router-devtools', () => ({ TanStackRouterDevtools: () => null }))
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }))
vi.mock('sonner', () => ({ Toaster: () => null }))

import { LoadingScreen } from '@/routes/__root'

describe('LoadingScreen', () => {
  it('renders a status region labelled with the loading message', () => {
    render(<LoadingScreen />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', 'Loading…')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('renders the visually-hidden loading text so screen readers announce it', () => {
    render(<LoadingScreen />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})
