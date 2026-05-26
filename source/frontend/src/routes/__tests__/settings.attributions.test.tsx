import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
}))

import { SettingsAttributionsPage } from '@/routes/settings.attributions'

describe('SettingsAttributionsPage', () => {
  it('renders the heading and a back link to /settings', () => {
    render(<SettingsAttributionsPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Attributions')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
  })

  it('lists the Freepik / Flaticon favicon credit as an external link', () => {
    render(<SettingsAttributionsPage />)

    const credit = screen.getByRole('link', {
      name: 'Money icons created by Freepik - Flaticon',
    })
    expect(credit).toHaveAttribute('href', 'https://www.flaticon.com/free-icons/money')
    expect(credit).toHaveAttribute('title', 'money icons')
    expect(credit).toHaveAttribute('target', '_blank')
    expect(credit).toHaveAttribute('rel', 'noopener noreferrer')
    // The credit is labelled with the asset it covers.
    expect(screen.getByText('Favicon')).toBeInTheDocument()
  })
})
