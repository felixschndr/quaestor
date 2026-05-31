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

import { SettingsVersionView } from '@/routes/settings.version'

describe('SettingsVersionView', () => {
  it('shows current and latest version with a link to the release when an update is available', () => {
    render(
      <SettingsVersionView
        versionInfo={{
          current: '0.1.0',
          latest: '0.1.9',
          update_available: true,
          release_url: 'https://github.com/felixschndr/quaestor/releases/tag/0.1.9',
        }}
        isLoading={false}
      />,
    )

    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    const releaseLink = screen.getByRole('link', { name: '0.1.9' })
    expect(releaseLink).toHaveAttribute(
      'href',
      'https://github.com/felixschndr/quaestor/releases/tag/0.1.9',
    )
    expect(screen.getByText('An update is available')).toBeInTheDocument()
  })

  it('reports an up-to-date server', () => {
    render(
      <SettingsVersionView
        versionInfo={{
          current: '0.1.11',
          latest: '0.1.9',
          update_available: false,
          release_url: 'https://x/0.1.9',
        }}
        isLoading={false}
      />,
    )
    expect(screen.getByText('Your server is up to date')).toBeInTheDocument()
  })

  it('shows a failure note when the latest version could not be fetched', () => {
    render(
      <SettingsVersionView
        versionInfo={{
          current: '0.1.11',
          latest: null,
          update_available: false,
          release_url: null,
        }}
        isLoading={false}
      />,
    )
    expect(screen.getAllByText("Couldn't check for updates").length).toBeGreaterThan(0)
  })
})
