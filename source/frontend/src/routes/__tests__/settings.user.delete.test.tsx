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
  useRouter: () => ({ history: { push: vi.fn() } }),
}))

import { SettingsDeleteAccountView } from '@/routes/settings.user.delete'
import { buildUser, renderWithQuery } from './-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

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
})
