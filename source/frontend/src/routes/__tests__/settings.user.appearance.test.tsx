import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

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

import { SettingsAppearanceView } from '@/routes/settings.user.appearance'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsAppearanceView', () => {
  it('prefills the language and sorts the dropdown by localised label', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        // Server returns "en" before "de"; the UI must reorder alphabetically by label.
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await screen.findByRole('option', { name: 'German' })
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    expect(select).toHaveValue('en')
    const labels = Array.from(select.options).map((option) => option.textContent ?? '')
    expect(labels).toEqual(['English', 'German'])
  })

  it('PATCHes the language when the dropdown changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en', 'de'] } }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser({ language: 'de' }) }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    const select = screen.getByLabelText('Language')
    await screen.findByRole('option', { name: 'German' })
    await user.selectOptions(select, 'de')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ language: 'de' })
    })
  })

  it('PATCHes the theme when the dropdown changes', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/i18n/languages') {
        return Promise.resolve(jsonResponse({ status: 200, body: { languages: ['en'] } }))
      }
      if (url === '/api/users/1') {
        return Promise.resolve(jsonResponse({ status: 200, body: buildUser({ theme: 'DARK' }) }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsAppearanceView user={buildUser()} />)

    await user.selectOptions(screen.getByLabelText('Appearance'), 'DARK')

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ theme: 'DARK' })
    })
  })
})
