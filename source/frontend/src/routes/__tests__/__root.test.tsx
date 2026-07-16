import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  createRootRouteWithContext: () => () => ({}),
}))
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
