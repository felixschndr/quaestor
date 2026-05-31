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
      '/settings/version',
      '/settings/attributions',
    ])
  })

  it('shows the default version description when no update is available', () => {
    render(
      <SettingsIndexView
        logoutPending={false}
        onLogout={vi.fn()}
        serverVersion={{
          current: '0.1.11',
          latest: '0.1.9',
          update_available: false,
          release_url: null,
        }}
      />,
    )
    expect(screen.getByText('Current and latest available version')).toBeInTheDocument()
  })

  it('announces an available update in the description', () => {
    render(
      <SettingsIndexView
        logoutPending={false}
        onLogout={vi.fn()}
        serverVersion={{
          current: '0.1.0',
          latest: '0.1.9',
          update_available: true,
          release_url: 'https://x/0.1.9',
        }}
      />,
    )
    expect(screen.getByText('Update available: 0.1.9')).toBeInTheDocument()
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
