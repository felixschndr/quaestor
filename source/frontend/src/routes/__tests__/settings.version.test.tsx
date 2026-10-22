import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { SettingsVersionView } from '@/pages/settings.version'
import { Route } from '@/routes/settings.version'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { RELEASE_URL, VERSION_CURRENT, VERSION_LATEST } from '@/test/constants'

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

  it('shows placeholders instead of versions while loading', () => {
    render(<SettingsVersionView versionInfo={undefined} isLoading={true} />)

    expect(screen.getAllByText('…')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: VERSION_LATEST })).not.toBeInTheDocument()
  })

  it('shows the latest version as plain text when there is no release page', () => {
    render(
      <SettingsVersionView
        versionInfo={{
          current: VERSION_CURRENT,
          latest: VERSION_LATEST,
          update_available: true,
          release_url: null,
        }}
        isLoading={false}
      />,
    )

    expect(screen.getByText(VERSION_LATEST)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: VERSION_LATEST })).not.toBeInTheDocument()
  })
})

describe('SettingsVersionPage', () => {
  const Page = Route.options.component!

  it('loads the server version and links the latest release', async () => {
    globalThis.fetch = vi.fn(async (url: string) =>
      url === '/api/version'
        ? jsonResponse({
            status: 200,
            body: {
              current: VERSION_CURRENT,
              latest: VERSION_LATEST,
              update_available: true,
              release_url: RELEASE_URL,
            },
          })
        : jsonResponse({ status: 404 }),
    ) as unknown as typeof fetch

    renderWithQuery(<Page />)

    expect(screen.getAllByText('…')).toHaveLength(2)
    expect(await screen.findByRole('link', { name: VERSION_LATEST })).toHaveAttribute(
      'href',
      RELEASE_URL,
    )
    expect(screen.getByText(VERSION_CURRENT)).toBeInTheDocument()
    expect(screen.getByText('An update is available')).toBeInTheDocument()
  })
})
