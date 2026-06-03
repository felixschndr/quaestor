import { screen, waitFor, within } from '@testing-library/react'
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

import { SettingsProfileView } from '@/routes/settings.user.profile'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsProfileView', () => {
  it('prefills the username and display name', () => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    expect(screen.getByLabelText('Display name')).toHaveValue('Alice')
  })

  it('PATCHes the display name when the user saves', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/users/1') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: buildUser({ display_name: 'Renamed' }) }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    const input = screen.getByLabelText('Display name')
    await user.clear(input)
    await user.type(input, 'Renamed')
    const form = input.closest('form')!
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ display_name: 'Renamed' })
    })
  })

  it('PATCHes the username (normalised) when the user saves', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/users/1') {
        return Promise.resolve(
          jsonResponse({ status: 200, body: buildUser({ user_name: 'newname' }) }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    const input = screen.getByLabelText('Username')
    await user.clear(input)
    await user.type(input, '  NewName  ')
    const form = input.closest('form')!
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
      )
      expect(patch).toBeTruthy()
      expect(JSON.parse(patch![1].body)).toEqual({ user_name: 'newname' })
    })
  })

  it('shows an inline error on the username field when the server returns 409', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/users/1' && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse({ status: 409, body: { detail: 'User name already taken' } }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    const input = screen.getByLabelText('Username')
    await user.clear(input)
    await user.type(input, 'taken')
    const form = input.closest('form')!
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('This username is already taken')).toBeInTheDocument()
  })
})
