import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { CredentialRead } from '@/lib/auth'
import { ACCOUNT_NAME_GIRO, ACCOUNT_NAME_SAVINGS } from '@/test/constants'

const routerLocation = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('@tanstack/react-router', async () => {
  const { NavLinkMock, routerMocks } = await import('@/routes/__tests__/-routerMock')
  return routerMocks({
    Link: NavLinkMock,
    useRouterState: ({
      select,
    }: {
      select: (state: { location: typeof routerLocation }) => unknown
    }) => select({ location: routerLocation }),
  })
})

import { BottomTabBar } from '@/components/bottom-tab-bar'
import {
  buildUser,
  jsonResponse,
  renderWithQuery,
} from '@/routes/__tests__/-settingsUserTestHelpers'

const VISIBLE_ACCOUNT_ID = 7
const HIDDEN_ACCOUNT_ID = 8

const credential: CredentialRead = {
  id: 1,
  bank: 'trade_republic',
  bank_name: null,
  bank_icon: null,
  accounts: [
    {
      id: VISIBLE_ACCOUNT_ID,
      name: ACCOUNT_NAME_GIRO,
      display_name: null,
      balance: 0,
      balance_factor: 100,
      is_archived: false,
      include_by_default: true,
      is_market_valued: false,
    },
    {
      id: HIDDEN_ACCOUNT_ID,
      name: ACCOUNT_NAME_SAVINGS,
      display_name: null,
      balance: 0,
      balance_factor: 100,
      is_archived: true,
      include_by_default: true,
      is_market_valued: false,
    },
  ],
  last_successful_sync_timestamp: null,
  requires_two_factor_authentication: false,
  sync_enabled: true,
}

function mockApi(contracts: { account_id: number; is_overdue: boolean }[]) {
  globalThis.fetch = vi.fn((url: string) =>
    Promise.resolve(
      url === '/api/auth/me'
        ? jsonResponse({ status: 200, body: buildUser({ credentials: [credential] }) })
        : jsonResponse({ status: 200, body: contracts.map((c, id) => ({ id, ...c })) }),
    ),
  ) as unknown as typeof fetch
}

const overdueDot = () =>
  screen.getByRole('link', { name: 'Contracts' }).querySelector('span[aria-hidden="true"]')

beforeEach(() => {
  routerLocation.pathname = '/'
  mockApi([])
})

describe('BottomTabBar', () => {
  it('links the four main sections', () => {
    renderWithQuery(<BottomTabBar />)

    const hrefs = Object.fromEntries(
      screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    )
    expect(hrefs).toEqual({
      Overview: '/',
      Search: '/search',
      Statistics: '/stats',
      Contracts: '/contracts',
    })
  })

  it('scopes search, statistics and contracts to the account being viewed', () => {
    routerLocation.pathname = `/account/${VISIBLE_ACCOUNT_ID}/transactions`
    renderWithQuery(<BottomTabBar />)

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/')
    for (const [name, path] of [
      ['Search', '/search'],
      ['Statistics', '/stats'],
      ['Contracts', '/contracts'],
    ]) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        `${path}?account_ids=${VISIBLE_ACCOUNT_ID}`,
      )
    }
  })

  it('flags the contracts tab once a contract of a shown account is overdue', async () => {
    mockApi([{ account_id: VISIBLE_ACCOUNT_ID, is_overdue: true }])
    renderWithQuery(<BottomTabBar />)

    await waitFor(() => expect(overdueDot()).not.toBeNull())
  })

  it('ignores overdue contracts of archived accounts and contracts on schedule', async () => {
    mockApi([
      { account_id: HIDDEN_ACCOUNT_ID, is_overdue: true },
      { account_id: VISIBLE_ACCOUNT_ID, is_overdue: false },
    ])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <BottomTabBar />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(client.getQueryData(['contracts'])).toHaveLength(2)
      expect(client.getQueryData(['auth', 'me'])).toBeDefined()
    })
    expect(overdueDot()).toBeNull()
  })
})
