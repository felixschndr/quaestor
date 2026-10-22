import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'
import i18n from 'i18next'

const historyPush = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: historyPush } }),
  }),
)
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))

import { SettingsDeleteAccountView } from '@/pages/settings.user.delete'
import { Route } from '@/routes/settings.user.delete'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function deleteRequests() {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([url, init]) => url === '/api/users/1' && init?.method === 'DELETE',
  )
}

describe('SettingsDeleteAccountView', () => {
  it('only deletes the account after a confirm step, then calls onAccountDeleted', async () => {
    const user = userEvent.setup()
    const fetchMock = globalThis.fetch as Mock
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/users/1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const onAccountDeleted = vi.fn()

    renderWithQuery(
      <SettingsDeleteAccountView user={buildUser()} onAccountDeleted={onAccountDeleted} />,
    )

    // First click: switch into confirm mode. No DELETE yet.
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(
      fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/users/1' && init?.method === 'DELETE',
      ),
    ).toBeUndefined()

    // Second click: confirm → DELETE fires and the callback runs.
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }))
    await waitFor(() => expect(onAccountDeleted).toHaveBeenCalledTimes(1))
  })

  it('backs out of the confirm step without deleting anything', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SettingsDeleteAccountView user={buildUser()} onAccountDeleted={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, delete my account' })).not.toBeInTheDocument()
    expect(deleteRequests()).toHaveLength(0)
  })

  it('keeps the account and reports the error when the deletion fails', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockResolvedValue(
      jsonResponse({ status: 429, body: { detail: 'slow down' } }),
    )
    const onAccountDeleted = vi.fn()
    renderWithQuery(
      <SettingsDeleteAccountView user={buildUser()} onAccountDeleted={onAccountDeleted} />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Too many attempts. Please wait a moment and try again.',
      ),
    )
    expect(onAccountDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
  })
})

describe('SettingsDeleteAccountPage', () => {
  const Page = Route.options.component!

  it('sends the user to the login page once the account is gone', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? jsonResponse({ status: 200, body: buildUser() })
          : url === '/api/users/1' && init?.method === 'DELETE'
            ? jsonResponse({ status: 204 })
            : jsonResponse({ status: 404 }),
      ),
    )

    renderWithQuery(<Page />)
    await user.click(await screen.findByRole('button', { name: 'Delete account' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }))

    await waitFor(() => expect(historyPush).toHaveBeenCalledWith('/login'))
    expect(deleteRequests()).toHaveLength(1)
  })

  it('renders nothing while the signed-in user is unknown', async () => {
    ;(globalThis.fetch as Mock).mockResolvedValue(jsonResponse({ status: 401 }))

    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
