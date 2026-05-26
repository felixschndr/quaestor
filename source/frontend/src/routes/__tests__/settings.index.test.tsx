import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

// TanStack Router's <Link> needs a router context. Replace with a plain anchor
// so we can assert hrefs; stub createFileRoute / useRouter so the module loads.
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
  useRouter: () => ({ history: { push: vi.fn() } }),
}))

import { SettingsIndexView } from '@/routes/settings.index'

describe('SettingsIndexView', () => {
  it('renders the heading and links to each settings sub-page', () => {
    render(<SettingsIndexView logoutPending={false} onLogout={vi.fn()} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings')
    const links = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/settings/'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings/user',
      '/settings/user/sessions',
      '/settings/credentials',
      '/settings/attributions',
    ])
  })

  it('includes a back link to the overview', () => {
    render(<SettingsIndexView logoutPending={false} onLogout={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
  })

  it('invokes onLogout when the logout button is clicked', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    render(<SettingsIndexView logoutPending={false} onLogout={onLogout} />)

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('disables the logout button while a logout is in flight', () => {
    render(<SettingsIndexView logoutPending={true} onLogout={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDisabled()
  })
})
