import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { UserRead } from '@/lib/auth'
import type { SyncJob } from '@/lib/credentials'
import type { ContractRead } from '@/lib/contract'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { OverviewView } from '@/pages'
import { sumFactoredBalance } from '@/lib/accountDisplayGroups'
import { buildUser } from './-settingsUserTestHelpers'
import {
  ACCOUNT_NAME_BROKER,
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_DAY,
  ACCOUNT_NAME_GIRO,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATE_FAR_FUTURE,
  DATE_LONG_OVERDUE,
  GROUP_NAME_SAVINGS,
  TEST_BALANCE,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  money,
} from '@/test/constants'

function buildCredential(): UserRead['credentials'][number] {
  return {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 8,
        name: TEST_IBAN,
        display_name: null,
        balance: AMOUNT_S,
        balance_factor: 100,
        is_hidden: false,
        include_by_default: true,
        is_market_valued: false,
      },
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
  }
}

function render_(user: UserRead) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewView user={user} onSyncClick={() => {}} syncDisabled={false} syncSpinning={false} />
    </QueryClientProvider>,
  )
}

function mockApi(
  bodies: {
    contracts?: unknown
    netWorth?: unknown
    layout?: unknown
    notificationLog?: unknown
  } = {},
) {
  globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/contracts')
      ? (bodies.contracts ?? [])
      : url.includes('/net-worth')
        ? (bodies.netWorth ?? { series: [], summary: null })
        : url.includes('/notification_log')
          ? (bodies.notificationLog ?? [])
          : (bodies.layout ?? { groups: [], ungrouped: [] })
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }) as unknown as typeof fetch
}

beforeEach(() => {
  window.localStorage.clear()
  mockApi()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OverviewView', () => {
  it('greets with display_name when set', () => {
    render_(buildUser({ display_name: 'Alice' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Alice')
  })

  it('falls back to user_name when display_name is blank', () => {
    render_(buildUser({ display_name: '', user_name: 'alice_user' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, alice_user')
  })

  it('renders the total balance formatted as EUR (de-DE locale)', () => {
    render_(buildUser({ balance: TEST_BALANCE, credentials: [buildCredential()] }))
    expect(screen.getByText(money(TEST_BALANCE))).toBeInTheDocument()
  })

  it('hides the balance and the account-only actions until a bank is connected', () => {
    render_(buildUser({ balance: 0 }))
    expect(screen.queryByText(money(0))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync all accounts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Statistics' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect your first bank' })).toBeInTheDocument()
  })

  it('shows the empty state and a CTA linking to /settings/credentials when there are no accounts', () => {
    render_(buildUser({ credentials: [] }))
    expect(screen.getByText('No accounts yet')).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: 'Connect your first bank' })
    expect(cta).toHaveAttribute('href', '/settings/credentials/new')
  })

  it('renders the cog link to /settings', () => {
    render_(buildUser())
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('puts the notification log between the settings cog and the privacy toggle', () => {
    render_(buildUser({ credentials: [buildCredential()] }))

    const log = screen.getByRole('link', { name: 'Notification history' })
    expect(log).toHaveAttribute('href', '/notifications')
    const settings = screen.getByRole('link', { name: 'Settings' })
    const privacy = screen.getByRole('button', { name: 'Hide amounts' })
    expect(settings.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(log.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('counts unread notifications on the log link once they arrive', async () => {
    mockApi({
      notificationLog: [
        { id: 1, title: 'A', body: 'B', url: null, created_at: null, read_at: null },
      ],
    })
    render_(buildUser())

    expect(
      await screen.findByRole('link', { name: 'Notification history – 1 unread' }),
    ).toBeInTheDocument()
  })

  it('renders the search link pointing at the global search route', () => {
    const user = buildUser({
      credentials: [
        {
          id: 10,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 5,
              name: ACCOUNT_NAME_GIRO,
              display_name: null,
              balance: 0,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
            {
              id: 7,
              name: ACCOUNT_NAME_DAY,
              display_name: null,
              balance: 0,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)
    const search = screen.getByRole('link', { name: 'Search transactions' })
    expect(search).toHaveAttribute('href', '/search')
    const settings = screen.getByRole('link', { name: 'Settings' })
    expect(search.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('omits the search link when there are no accounts', () => {
    render_(buildUser({ credentials: [] }))
    expect(screen.queryByRole('link', { name: 'Search transactions' })).not.toBeInTheDocument()
  })

  it('groups accounts by bank (alphabetical) and sorts accounts within each bank', () => {
    const user = buildUser({
      credentials: [
        {
          id: 10,
          bank: 'trade_republic',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 1,
              name: ACCOUNT_NAME_BROKER,
              display_name: null,
              balance: AMOUNT_M,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
        {
          id: 11,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 2,
              name: ACCOUNT_NAME_DAY,
              display_name: null,
              balance: AMOUNT_XL,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
            {
              id: 3,
              name: ACCOUNT_NAME_GIRO,
              display_name: null,
              balance: -AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })

    render_(user)
    const accountLinks = screen
      .getAllByRole('link')
      .filter((link) => /^\/account\/\d+$/.test(link.getAttribute('href') ?? ''))
    // ing rows come first (banks alphabetical: ing < trade_republic);
    // within ing, Girokonto < Tagesgeld.
    expect(accountLinks.map((link) => link.textContent)).toEqual([
      expect.stringContaining(ACCOUNT_NAME_GIRO),
      expect.stringContaining(ACCOUNT_NAME_DAY),
      expect.stringContaining(ACCOUNT_NAME_BROKER),
    ])
    expect(accountLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/account/3',
      '/account/2',
      '/account/1',
    ])
  })

  it('uses the personalised name instead of the IBAN when set, and only that', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 8,
              name: TEST_IBAN,
              display_name: ACCOUNT_NAME_CHECKING,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)
    // The personalised name shows up.
    expect(screen.getByText(ACCOUNT_NAME_CHECKING)).toBeInTheDocument()
    // The IBAN does NOT (the overview is supposed to be just the personalised name)
    expect(screen.queryByText(TEST_IBAN_FORMATTED)).not.toBeInTheDocument()
  })

  it('renders custom group headings when the user has defined account groups', async () => {
    mockApi({
      layout: {
        groups: [{ id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 8 }] }],
        ungrouped: [],
      },
    })

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 8,
              name: TEST_IBAN,
              display_name: ACCOUNT_NAME_CHECKING,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: new RegExp(GROUP_NAME_SAVINGS),
    })
    expect(heading).toBeInTheDocument()
  })

  it('shows a factored total next to each custom group heading', async () => {
    mockApi({
      layout: {
        groups: [{ id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 8 }, { id: 9 }] }],
        ungrouped: [{ id: 10 }],
      },
    })

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            // Factored: 100 * 100 / 100 = 100
            {
              id: 8,
              name: 'Acc8',
              display_name: null,
              balance: 100,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
            // Factored: 200 * 50 / 100 = 100  →  group total = 200,00 €
            {
              id: 9,
              name: 'Acc9',
              display_name: null,
              balance: 200,
              balance_factor: 50,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
            // Ungrouped factored: -50 * 100 / 100 = -50  →  destructive color
            {
              id: 10,
              name: 'Acc10',
              display_name: null,
              balance: -50,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)

    const sparHeading = await screen.findByRole('heading', {
      level: 2,
      name: new RegExp(GROUP_NAME_SAVINGS),
    })
    expect(sparHeading).toHaveTextContent(money(200))

    const ungroupedHeading = await screen.findByRole('heading', { level: 2, name: /Without group/ })
    const spans = ungroupedHeading.querySelectorAll('span')
    const total = spans[spans.length - 1]
    expect(total).toHaveTextContent(money(-AMOUNT_M))
    expect(total?.className).toMatch(/text-destructive/)
  })

  it('renders the "without group" heading when the layout has ungrouped accounts', async () => {
    mockApi({
      layout: {
        groups: [{ id: 100, name: GROUP_NAME_SAVINGS, accounts: [] }],
        ungrouped: [{ id: 8 }],
      },
    })

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 8,
              name: TEST_IBAN,
              display_name: ACCOUNT_NAME_CHECKING,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)

    expect(
      await screen.findByRole('heading', { level: 2, name: /Without group/ }),
    ).toBeInTheDocument()
  })

  it('omits hidden accounts from the list and from group totals', async () => {
    mockApi({
      layout: {
        groups: [{ id: 1, name: GROUP_NAME_SAVINGS, accounts: [{ id: 11 }, { id: 12 }] }],
        ungrouped: [],
      },
    })

    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 11,
              name: 'Visible',
              display_name: null,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
            {
              id: 12,
              name: 'HiddenSub',
              display_name: null,
              balance: 9999,
              balance_factor: 100,
              is_hidden: true,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: new RegExp(GROUP_NAME_SAVINGS),
    })
    // Group total = 100 only (hidden 9999 doesn't count).
    expect(heading.parentElement).toHaveTextContent(money(AMOUNT_L))
    expect(screen.getByText('Visible')).toBeInTheDocument()
    // The hidden account's IBAN-formatted name must not surface anywhere.
    expect(screen.queryByText('HiddenSub')).not.toBeInTheDocument()
  })

  it('applies balance_factor as a percentage when summing group totals', () => {
    expect(
      sumFactoredBalance([
        { balance: 100, balance_factor: 100 },
        { balance: 200, balance_factor: 50 },
        { balance: -40, balance_factor: 25 },
      ]),
    ).toBe(100 + 100 - 10)
    expect(sumFactoredBalance([])).toBe(0)
  })

  function buildGroupedUser() {
    mockApi({
      layout: {
        groups: [{ id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 8 }] }],
        ungrouped: [],
      },
    })

    return buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 8,
              name: ACCOUNT_NAME_CHECKING,
              display_name: ACCOUNT_NAME_CHECKING,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
  }

  it('collapses a group when its heading is clicked, hiding the accounts', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: new RegExp(GROUP_NAME_SAVINGS) })
    expect(screen.getByText(ACCOUNT_NAME_CHECKING)).toBeInTheDocument()

    await userEvent.click(trigger)

    await waitFor(() => expect(screen.queryByText(ACCOUNT_NAME_CHECKING)).not.toBeInTheDocument())
  })

  it('flips aria-expanded on the group trigger when toggled', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: new RegExp(GROUP_NAME_SAVINGS) })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the group total visible while collapsed', async () => {
    render_(buildGroupedUser())
    const trigger = await screen.findByRole('button', { name: new RegExp(GROUP_NAME_SAVINGS) })

    await userEvent.click(trigger)

    await waitFor(() => expect(screen.queryByText(ACCOUNT_NAME_CHECKING)).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent(money(AMOUNT_L))
  })

  it('does not render a collapse trigger for the legacy by-bank layout', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 2,
              name: ACCOUNT_NAME_GIRO,
              display_name: null,
              balance: AMOUNT_L,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)
    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(document.querySelector('[aria-expanded]')).toBeNull()
  })

  it('renders negative account balances in the destructive color', () => {
    const user = buildUser({
      credentials: [
        {
          id: 1,
          bank: 'ing',
          bank_name: null,
          bank_icon: null,
          accounts: [
            {
              id: 7,
              name: 'Overdrawn',
              display_name: null,
              balance: -150.5,
              balance_factor: 100,
              is_hidden: false,
              include_by_default: true,
              is_market_valued: false,
            },
          ],
          last_fetching_timestamp: null,
          requires_two_factor_authentication: false,
          sync_enabled: true,
        },
      ],
    })
    render_(user)
    const amount = screen.getByText(money(-150.5))
    expect(amount.className).toMatch(/text-destructive/)
  })

  it('spins only the accounts whose credential is still syncing, then shows a check', async () => {
    const credential = (id: number, accountId: number, name: string) => ({
      id,
      bank: 'ing',
      bank_name: null,
      bank_icon: null,
      accounts: [
        {
          id: accountId,
          name,
          display_name: null,
          balance: 0,
          balance_factor: 100,
          is_hidden: false,
          include_by_default: true,
          is_market_valued: false,
        },
      ],
      last_fetching_timestamp: null,
      requires_two_factor_authentication: false,
      sync_enabled: true,
    })
    const user = buildUser({ credentials: [credential(1, 11, 'Slow'), credential(2, 22, 'Fast')] })
    const job = (credentialId: number, status: SyncJob['status']): SyncJob => ({
      job_id: `j${credentialId}`,
      credential_id: credentialId,
      status,
      expires_at: null,
      error: null,
      error_code: null,
    })
    const view = (jobs: Map<number, SyncJob>) => (
      <OverviewView
        user={user}
        onSyncClick={() => {}}
        syncDisabled={false}
        syncSpinning={true}
        syncJobs={jobs}
      />
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        {view(
          new Map([
            [1, job(1, 'running')],
            [2, job(2, 'running')],
          ]),
        )}
      </QueryClientProvider>,
    )
    expect(screen.getAllByLabelText('Syncing')).toHaveLength(2)

    rerender(
      <QueryClientProvider client={queryClient}>
        {view(
          new Map([
            [1, job(1, 'running')],
            [2, job(2, 'completed')],
          ]),
        )}
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText('Synced')).toBeInTheDocument())
    expect(screen.getAllByLabelText('Syncing')).toHaveLength(1)
  })

  it('marks a failed account, but not one the user cancelled', () => {
    const credential = (id: number, accountId: number, name: string) => ({
      id,
      bank: 'ing',
      bank_name: null,
      bank_icon: null,
      accounts: [
        {
          id: accountId,
          name,
          display_name: null,
          balance: 0,
          balance_factor: 100,
          is_hidden: false,
          include_by_default: true,
          is_market_valued: false,
        },
      ],
      last_fetching_timestamp: null,
      requires_two_factor_authentication: false,
      sync_enabled: true,
    })
    const user = buildUser({
      credentials: [credential(1, 11, 'Broken'), credential(2, 22, 'Skipped')],
    })
    const job = (credentialId: number, errorCode: SyncJob['error_code']): SyncJob => ({
      job_id: `j${credentialId}`,
      credential_id: credentialId,
      status: 'failed',
      expires_at: null,
      error: null,
      error_code: errorCode,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <OverviewView
          user={user}
          onSyncClick={() => {}}
          syncDisabled={false}
          syncSpinning={false}
          syncJobs={
            new Map([
              [1, job(1, 'unknown')],
              [2, job(2, 'cancelled')],
            ])
          }
        />
      </QueryClientProvider>,
    )
    expect(screen.getAllByLabelText('Sync failed')).toHaveLength(1)
  })
})

describe('OverviewView hero extras', () => {
  function series(...values: number[]) {
    return {
      series: values.map((value, index) => ({ date: `2026-07-${10 + index}`, value })),
      summary: null,
    }
  }

  it('shows the one-month delta with its sign and percentage, linking to the stats', async () => {
    mockApi({ netWorth: series(1000, 1100, 1200) })
    render_(buildUser({ balance: 1200, credentials: [buildCredential()] }))

    const trend = await screen.findByRole('link', { name: /past month/ })
    expect(trend).toHaveAttribute('href', '/stats')
    expect(trend).toHaveTextContent(`+${money(200)}`)
    expect(trend).toHaveTextContent('20,0 %')
  })

  it('colours a shrinking net worth as a loss', async () => {
    mockApi({ netWorth: series(1000, 400) })
    render_(buildUser({ balance: 400, credentials: [buildCredential()] }))

    const trend = await screen.findByRole('link', { name: /past month/ })
    expect(trend).toHaveTextContent(money(-600))
    expect(trend.querySelector('span')?.className).toMatch(/text-destructive/)
  })

  it('omits the trend when the series has fewer than two points', async () => {
    mockApi({ netWorth: series(1000) })
    render_(buildUser({ balance: 1000, credentials: [buildCredential()] }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /past month/ })).not.toBeInTheDocument(),
    )
  })

  it('warns on the sync button and the lagging account when a bank is more than 5 days old', () => {
    const stale = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(Date.now() - 60 * 1000).toISOString()
    const credential = (id: number, accountId: number, timestamp: string) => ({
      ...buildCredential(),
      id,
      accounts: [{ ...buildCredential().accounts[0], id: accountId }],
      last_fetching_timestamp: timestamp,
    })
    render_(
      buildUser({
        balance: AMOUNT_S,
        credentials: [credential(1, 8, fresh), credential(2, 9, stale)],
      }),
    )
    const syncButton = screen.getByRole('button', { name: 'Sync all accounts' })
    expect(syncButton.querySelector('.bg-warning')).not.toBeNull()
    expect(document.querySelector('a[href="/account/9"] .bg-warning')).not.toBeNull()
    expect(document.querySelector('a[href="/account/8"] .bg-warning')).toBeNull()
  })

  it('stays silent about syncing while every bank is current', () => {
    const fresh = new Date(Date.now() - 60 * 1000).toISOString()
    render_(
      buildUser({
        balance: AMOUNT_S,
        credentials: [{ ...buildCredential(), last_fetching_timestamp: fresh }],
      }),
    )
    const syncButton = screen.getByRole('button', { name: 'Sync all accounts' })
    expect(syncButton.querySelector('.bg-warning')).toBeNull()
  })

  it('leaves banks with syncing switched off out of the staleness check', () => {
    const long_ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(Date.now() - 60 * 1000).toISOString()
    render_(
      buildUser({
        balance: AMOUNT_S,
        credentials: [
          { ...buildCredential(), id: 1, last_fetching_timestamp: fresh },
          {
            ...buildCredential(),
            id: 2,
            accounts: [{ ...buildCredential().accounts[0], id: 9 }],
            last_fetching_timestamp: long_ago,
            sync_enabled: false,
          },
        ],
      }),
    )
    const syncButton = screen.getByRole('button', { name: 'Sync all accounts' })
    expect(syncButton.querySelector('.bg-warning')).toBeNull()
    expect(document.querySelector('a[href="/account/9"] .bg-warning')).toBeNull()
  })
})

describe('OverviewView upcoming contracts', () => {
  function contract(overrides: Partial<ContractRead>): ContractRead {
    return {
      id: 1,
      account_id: 8,
      name: 'Netflix',
      note: null,
      category: 'ENTERTAINMENT',
      source: 'DETECTED',
      median_amount: -12.99,
      frequency: 'MONTHLY',
      expected_next_date: DATE_FAR_FUTURE,
      end_date: null,
      is_archived: false,
      is_overdue: false,
      amount_per_day: -0.43,
      amount_per_frequency: null,
      ...overrides,
    }
  }

  it('lists every overdue contract first, then only the next three payments', async () => {
    mockApi({
      contracts: [
        contract({ id: 1, name: 'Spotify', expected_next_date: '2099-01-04' }),
        contract({ id: 2, name: 'Netflix', expected_next_date: '2099-01-02' }),
        contract({ id: 3, name: 'Gym', expected_next_date: '2099-01-03' }),
        contract({ id: 4, name: 'Newspaper', expected_next_date: '2099-01-05' }),
        contract({ id: 5, name: 'Rent', expected_next_date: DATE_LONG_OVERDUE, is_overdue: true }),
      ],
    })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    await screen.findByText('Rent')
    const names = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href) => href?.startsWith('/contracts/'))
    expect(names).toEqual(['/contracts/5', '/contracts/2', '/contracts/3', '/contracts/1'])
    expect(screen.queryByText('Newspaper')).not.toBeInTheDocument()
    expect(screen.getByText('Overdue').className).toMatch(/text-warning/)
  })

  it('ignores contracts of accounts that are not on the overview', async () => {
    mockApi({ contracts: [contract({ account_id: 999 })] })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    await waitFor(() => expect(screen.queryByText('Due soon contracts')).not.toBeInTheDocument())
  })
})

describe('OverviewView overdue badge', () => {
  const overdue = {
    id: 1,
    account_id: 8,
    name: 'Rent',
    note: null,
    category: 'RENT',
    source: 'DETECTED',
    median_amount: -800,
    frequency: 'MONTHLY',
    expected_next_date: DATE_LONG_OVERDUE,
    end_date: null,
    is_archived: false,
    is_overdue: true,
    amount_per_day: -26,
    amount_per_frequency: null,
  } satisfies ContractRead

  it('counts overdue contracts into the contracts icon label', async () => {
    mockApi({ contracts: [overdue, { ...overdue, id: 2, name: 'Gym' }] })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    expect(await screen.findByRole('link', { name: 'Contracts – 2 overdue' })).toBeInTheDocument()
  })

  it('leaves the plain label when nothing is overdue', async () => {
    mockApi({ contracts: [{ ...overdue, is_overdue: false, expected_next_date: DATE_FAR_FUTURE }] })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    await screen.findByRole('link', { name: 'Contracts' })
    expect(screen.queryByRole('link', { name: /overdue/ })).not.toBeInTheDocument()
  })

  it('ignores contracts of accounts that are not on the overview', async () => {
    mockApi({ contracts: [{ ...overdue, account_id: 999 }] })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    await screen.findByRole('link', { name: 'Contracts' })
  })
})

describe('OverviewView privacy mode', () => {
  afterEach(() => {
    delete document.documentElement.dataset.privacy
  })

  it('blurs the amounts, remembers the choice and flips the label back', async () => {
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    expect(document.documentElement).not.toHaveAttribute('data-privacy')
    await userEvent.click(screen.getByRole('button', { name: 'Hide amounts' }))

    expect(document.documentElement).toHaveAttribute('data-privacy', 'on')
    expect(window.localStorage.getItem('privacyMode')).toBe('on')
    for (const amount of screen.getAllByText(money(AMOUNT_S))) {
      expect(amount.closest('.private-amount')).not.toBeNull()
    }

    await userEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(document.documentElement).not.toHaveAttribute('data-privacy')
    expect(window.localStorage.getItem('privacyMode')).toBeNull()
  })

  it('starts hidden when the last session left it that way', () => {
    window.localStorage.setItem('privacyMode', 'on')
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    expect(document.documentElement).toHaveAttribute('data-privacy', 'on')
    expect(screen.getByRole('button', { name: 'Show amounts' })).toBeInTheDocument()
  })
})

describe('OverviewView sync progress', () => {
  const job = (credentialId: number, status: SyncJob['status']): SyncJob => ({
    job_id: `j${credentialId}`,
    credential_id: credentialId,
    status,
    expires_at: null,
    error: null,
    error_code: null,
  })

  function renderWithJobs(jobs: Map<number, SyncJob>) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <OverviewView
          user={buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] })}
          onSyncClick={() => {}}
          syncDisabled={false}
          syncSpinning={true}
          syncJobs={jobs}
        />
      </QueryClientProvider>,
    )
  }

  it('counts the finished banks while at least one is still running', () => {
    renderWithJobs(
      new Map([
        [1, job(1, 'completed')],
        [2, job(2, 'failed')],
        [3, job(3, 'running')],
      ]),
    )
    expect(screen.getByText('2 of 3 banks synced')).toBeInTheDocument()
  })

  it('drops the line once every bank is done', () => {
    renderWithJobs(new Map([[1, job(1, 'completed')]]))
    expect(screen.queryByText(/banks synced/)).not.toBeInTheDocument()
  })

  it('keeps a spinner on the group header of a collapsed group', async () => {
    mockApi({
      layout: {
        groups: [{ id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 8 }] }],
        ungrouped: [],
      },
    })
    renderWithJobs(new Map([[1, job(1, 'running')]]))

    const trigger = await screen.findByRole('button', { name: new RegExp(GROUP_NAME_SAVINGS) })
    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Syncing')).toBeInTheDocument()
  })
})

describe('OverviewView upcoming contracts visibility', () => {
  const contract = {
    id: 1,
    account_id: 8,
    name: 'Netflix',
    note: null,
    category: 'ENTERTAINMENT',
    source: 'DETECTED',
    median_amount: -12.99,
    frequency: 'MONTHLY',
    expected_next_date: DATE_FAR_FUTURE,
    end_date: null,
    is_archived: false,
    is_overdue: false,
    amount_per_day: -0.43,
    amount_per_frequency: null,
  } satisfies ContractRead

  it('hides the section when the user switched it off', async () => {
    mockApi({ contracts: [contract] })
    render_(
      buildUser({
        balance: AMOUNT_S,
        credentials: [buildCredential()],
        show_upcoming_contracts: false,
      }),
    )
    await waitFor(() => expect(screen.queryByText('Netflix')).not.toBeInTheDocument())
  })

  it('collapses the section and remembers it, like an account group', async () => {
    mockApi({ contracts: [contract] })
    render_(buildUser({ balance: AMOUNT_S, credentials: [buildCredential()] }))

    const trigger = await screen.findByRole('button', { name: /Due soon contracts/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'View all' })).toBeInTheDocument()

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Netflix/ })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'View all' })).not.toBeInTheDocument()
    expect(trigger).not.toHaveTextContent('Netflix')
    expect(trigger).toHaveTextContent(money(-12.99))
    expect(window.localStorage.getItem('collapsedGroups')).toContain('upcomingContracts')
  })
})
