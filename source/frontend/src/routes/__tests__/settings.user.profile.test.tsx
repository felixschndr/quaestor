import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsProfileView } from '@/pages/settings.user.profile'
import { Route } from '@/routes/settings.user.profile'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function patchRequests() {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([url, init]) => url === '/api/users/1' && init?.method === 'PATCH',
  )
}

async function saveField(label: string, value: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText(label)
  await user.clear(input)
  if (value) await user.type(input, value)
  await user.click(within(input.closest('form')!).getByRole('button', { name: 'Save' }))
}

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

  it('confirms a saved display name with a toast', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(
      jsonResponse({ status: 200, body: buildUser({ display_name: 'Renamed' }) }),
    )
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField('Display name', 'Renamed')

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['Username', 'bob'],
    ['Display name', 'Bob'],
  ])('reports a failed %s change with a toast', async (label, value) => {
    ;(globalThis.fetch as Mock).mockResolvedValue(
      jsonResponse({ status: 500, body: { detail: 'boom' } }),
    )
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField(label, value)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(['Username', 'Display name'])('requires a %s before saving', async (label) => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    await saveField(label, '')

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(patchRequests()).toHaveLength(0)
  })

  it('keeps Save disabled and sends nothing while the values are unchanged', () => {
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    for (const label of ['Username', 'Display name']) {
      const form = screen.getByLabelText(label).closest('form')!
      expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
      fireEvent.submit(form)
    }

    expect(patchRequests()).toHaveLength(0)
  })

  it('ignores a username that only differs in case and surrounding spaces', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SettingsProfileView user={buildUser()} />)

    const input = screen.getByLabelText('Username')
    await user.clear(input)
    await user.type(input, ' ALICE ')

    expect(within(input.closest('form')!).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('SettingsProfilePage', () => {
  const Page = Route.options.component!

  it('shows the profile of the signed-in user', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? jsonResponse({ status: 200, body: buildUser({ display_name: 'Alice Doe' }) })
          : jsonResponse({ status: 404 }),
      ),
    )

    renderWithQuery(<Page />)

    expect(await screen.findByLabelText('Display name')).toHaveValue('Alice Doe')
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(jsonResponse({ status: 401 }))

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
