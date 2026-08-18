import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'
import type { CredentialRead } from '@/lib/auth'
import {
  ACCOUNT_NAME_BROKER,
  ACCOUNT_NAME_DAY,
  ACCOUNT_NAME_GIRO,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATE_RECENT,
  DATE_YEAR_START,
  DATE_YESTERDAY,
  LABEL_GROCERIES,
  LABEL_SALARY,
  PARTY_SUPERMARKET,
  money,
} from '@/test/constants'

vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
  }),
)

vi.mock('@/lib/accountGroups', () => ({
  useAccountGroupLayout: () => ({ data: undefined }),
}))

import { type TransactionSearchParams } from '@/lib/transactionSearchParams'
import { TransactionSearchView } from '@/pages/search'

const credentials: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 42,
        name: ACCOUNT_NAME_GIRO,
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
        include_by_default: true,
        is_market_valued: false,
      },
      {
        id: 43,
        name: ACCOUNT_NAME_DAY,
        balance: 0,
        balance_factor: 100,
        display_name: null,
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
    id: 2,
    bank: 'trade_republic',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 99,
        name: ACCOUNT_NAME_BROKER,
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
        include_by_default: true,
        is_market_valued: false,
      },
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
  },
]

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
})

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

type ChangePayload = { accountIds: number[]; filters: TransactionFiltersLike }
type TransactionFiltersLike = Record<string, unknown>

function renderView(opts: { search?: Partial<TransactionSearchParams> } = {}) {
  const onChange = vi.fn()
  const onSortChange = vi.fn()
  renderWithClient(
    <TransactionSearchView
      credentials={credentials}
      search={(opts.search ?? {}) as TransactionSearchParams}
      onChange={onChange}
      onSortChange={onSortChange}
    />,
  )
  return { onChange, onSortChange }
}

function lastPayload(onChange: ReturnType<typeof vi.fn>): ChangePayload | undefined {
  return onChange.mock.calls.at(-1)?.[0]
}

describe('TransactionSearchView — form', () => {
  it('renders all filter fields', () => {
    renderView()
    expect(screen.getByLabelText('Accounts')).toBeInTheDocument()
    expect(screen.getByLabelText('Search text')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount from')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount to')).toBeInTheDocument()
    const dateTriggers = screen.getAllByRole('button', { name: 'Pick a date' })
    expect(dateTriggers).toHaveLength(2)
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Categories')).toBeInTheDocument()
    expect(screen.getByLabelText('Transfer')).toBeInTheDocument()
  })

  it('searches automatically — there is no submit button', () => {
    const { onChange } = renderView()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(onChange).toHaveBeenCalled()
  })

  it('emits the selected transfer (linked) filter', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Transfer'))
    await user.click(document.getElementById('transfer-unlinked')!)

    await waitFor(() => expect(lastPayload(onChange)?.filters.linked).toBe('linked'))
  })

  it('omits the transfer filter when left on "Any"', async () => {
    const { onChange } = renderView()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(lastPayload(onChange)?.filters.linked).toBeUndefined()
  })

  it('does not render a separate Note field — the freetext covers it', () => {
    renderView()
    expect(screen.queryByLabelText('Note')).toBeNull()
  })

  it('amount inputs use type=text + inputMode=decimal so iOS shows the decimal pad', () => {
    renderView()
    const amountFrom = screen.getByLabelText('Amount from') as HTMLInputElement
    expect(amountFrom.type).toBe('text')
    expect(amountFrom.inputMode).toBe('decimal')
  })

  it('amount can be made negative via the sign toggle (iOS decimal pad has no minus key)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    const amountFromGroup = screen.getByLabelText('Amount from').parentElement!
    await user.type(screen.getByLabelText('Amount from'), '12.5')
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))

    await waitFor(() => expect(lastPayload(onChange)?.filters.amount_from).toBe(-12.5))
  })

  it('sign toggle round-trips back to positive', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    const amountFromGroup = screen.getByLabelText('Amount from').parentElement!
    await user.type(screen.getByLabelText('Amount from'), '7')
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make positive' }))

    await waitFor(() => expect(lastPayload(onChange)?.filters.amount_from).toBe(7))
  })

  it('prefills the type and transfer pickers from the URL (a stats drill-in)', () => {
    renderView({ search: { transaction_types: ['FEES'], linked: 'linked' } })
    expect(screen.getByLabelText('Type').textContent).toContain('1 type')
    expect(screen.getByLabelText('Transfer').textContent).toContain('Transfer')
  })

  it('renders translated labels for the transaction type options', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Type'))
    expect(screen.getByText('Incoming')).toBeInTheDocument()
    expect(screen.getByText('Outgoing')).toBeInTheDocument()
    expect(screen.queryByText('INCOMING')).toBeNull()
  })

  it('renders a Popover-based date picker (consistent UI across browsers)', () => {
    renderView()
    expect(screen.getAllByRole('button', { name: 'Pick a date' })).toHaveLength(2)
  })

  it('back button falls back to the overview when there is no history', () => {
    renderView()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/')
  })

  it('emits only the filters the user filled in, plus the selected account ids', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.type(screen.getByLabelText('Search text'), 'rewe')
    await user.type(screen.getByLabelText('Amount from'), String(AMOUNT_M))

    await waitFor(() => {
      const payload = lastPayload(onChange)
      expect(payload?.filters.text).toBe('rewe')
      expect(payload?.filters.amount_from).toBe(AMOUNT_M)
    })
    const payload = lastPayload(onChange)
    expect(payload?.filters.amount_to).toBeUndefined()
    expect([...(payload?.accountIds ?? [])].sort((a, b) => a - b)).toEqual([42, 43, 99])
  })

  it('preserves the existing URL filters in the form', () => {
    renderView({ search: { text: 'gehalt', amount_from: AMOUNT_L } })
    expect((screen.getByLabelText('Search text') as HTMLInputElement).value).toBe('gehalt')
    expect((screen.getByLabelText('Amount from') as HTMLInputElement).value).toBe(String(AMOUNT_L))
  })
})

describe('TransactionSearchView — accounts multi-select', () => {
  it('selects all accounts by default', () => {
    renderView()
    expect(screen.getByLabelText('Accounts').textContent).toContain('All accounts')
  })

  it('lets the user narrow the accounts', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Accounts'))
    const tagesgeldRow = screen.getByText(ACCOUNT_NAME_DAY).closest('label')!
    await user.click(within(tagesgeldRow).getByRole('checkbox'))

    await waitFor(() =>
      expect([...(lastPayload(onChange)?.accountIds ?? [])].sort((a, b) => a - b)).toEqual([
        42, 99,
      ]),
    )
  })

  it('"All" selects every account', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Accounts'))
    await user.click(screen.getByRole('button', { name: 'All' }))

    await waitFor(() =>
      expect([...(lastPayload(onChange)?.accountIds ?? [])].sort((a, b) => a - b)).toEqual([
        42, 43, 99,
      ]),
    )
  })

  it('"None" clears the selection and hides the results', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Accounts'))
    await user.click(screen.getByRole('button', { name: 'None' }))

    await waitFor(() => expect(lastPayload(onChange)?.accountIds).toEqual([]))
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })

  it('shows the URL-provided account ids when present', () => {
    renderView({ search: { account_ids: [42, 99] } })
    // 2 accounts selected → trigger should show "2 accounts".
    expect(screen.getByLabelText('Accounts').textContent).toContain('2 accounts')
  })
})

describe('TransactionSearchView — results', () => {
  function mockFetchOnce(body: TransactionRead[]) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  }

  it('renders an empty-state message when the backend returns no matches', async () => {
    mockFetchOnce([])
    renderView({ search: { text: 'no match', account_ids: [42] } })
    expect(await screen.findByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('shows no results and does not search when no category is selected', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    renderView({ search: { account_ids: [42], categories: [] } })

    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    expect(screen.getByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('shows no results and does not search when no type is selected', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    renderView({ search: { account_ids: [42], transaction_types: [] } })

    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    expect(screen.getByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('renders one row per returned transaction with the right link and colour', async () => {
    mockFetchOnce([
      {
        id: 1,
        account_id: 42,
        amount: -AMOUNT_M,
        purpose: LABEL_GROCERIES,
        date: DATE_RECENT,
        other_party: PARTY_SUPERMARKET,
        transaction_type: 'OUTGOING',
        category: 'SUPERMARKET',
        note: null,
      },
      {
        id: 2,
        account_id: 42,
        amount: AMOUNT_XL,
        purpose: LABEL_SALARY,
        date: '2026-04-30',
        other_party: 'ACME',
        transaction_type: 'INCOMING',
        category: 'SALARY',
        note: null,
      },
    ])
    renderView({ search: { text: 'a', account_ids: [42] } })

    expect(await screen.findByText(PARTY_SUPERMARKET)).toBeInTheDocument()
    expect(screen.getByText('ACME')).toBeInTheDocument()
    expect(screen.getByText(money(-AMOUNT_M)).className).toMatch(/text-destructive/)
    expect(screen.getByText(money(AMOUNT_XL)).className).toMatch(/text-success/)
    expect(screen.getByText(PARTY_SUPERMARKET).closest('a')).toHaveAttribute(
      'href',
      '/transactions/1',
    )
  })

  it('shows the per-row account name only when more than one account is selected', async () => {
    mockFetchOnce([
      {
        id: 1,
        account_id: 42,
        amount: -AMOUNT_S,
        purpose: 'x',
        date: DATE_RECENT,
        other_party: PARTY_SUPERMARKET,
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
      {
        id: 2,
        account_id: 43,
        amount: -AMOUNT_M,
        purpose: 'y',
        date: DATE_YESTERDAY,
        other_party: 'Aldi',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({ search: { account_ids: [42, 43] } })

    // Each row's subtitle (date + account name) should mention the account.
    expect(await screen.findByText(new RegExp(ACCOUNT_NAME_GIRO))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(ACCOUNT_NAME_DAY))).toBeInTheDocument()
  })

  it('links each result row to its own account, not to the anchor', async () => {
    mockFetchOnce([
      {
        id: 7,
        account_id: 99,
        amount: AMOUNT_S,
        purpose: 'x',
        date: DATE_RECENT,
        other_party: 'Other',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({ search: { account_ids: [42, 99] } })

    const link = await screen.findByText('Other')
    expect(link.closest('a')).toHaveAttribute('href', '/transactions/7')
  })
})

describe('TransactionSearchView — link mode', () => {
  function mockFetchOnce(body: TransactionRead[]) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch
  }

  it('shows the link-mode hint when link params are present', () => {
    renderView({ search: { link_account_id: 42, link_transaction_id: 7 } })
    expect(screen.getByText('Pick the transaction to link with.')).toBeInTheDocument()
  })

  it('does not show the hint without link params', () => {
    renderView()
    expect(screen.queryByText('Pick the transaction to link with.')).toBeNull()
  })

  it('excludes the link-source transaction itself from the results', async () => {
    mockFetchOnce([
      {
        id: 7,
        account_id: 42,
        amount: -AMOUNT_S,
        purpose: 'source',
        date: DATE_RECENT,
        other_party: 'Source Party',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
      {
        id: 8,
        account_id: 42,
        amount: AMOUNT_S,
        purpose: 'candidate',
        date: DATE_RECENT,
        other_party: 'Candidate Party',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Candidate Party')).toBeInTheDocument()
    expect(screen.queryByText('Source Party')).toBeNull()
  })

  it('excludes pending transactions from the results (they cannot be linked)', async () => {
    mockFetchOnce([
      {
        id: 8,
        account_id: 42,
        amount: AMOUNT_S,
        purpose: 'booked',
        date: DATE_RECENT,
        other_party: 'Booked Party',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
        pending: false,
      },
      {
        id: 9,
        account_id: 42,
        amount: AMOUNT_S,
        purpose: 'pending',
        date: DATE_RECENT,
        other_party: 'Pending Party',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
        pending: true,
      },
    ])
    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Booked Party')).toBeInTheDocument()
    expect(screen.queryByText('Pending Party')).toBeNull()
  })

  it('excludes transactions already in the source flow (linking them again would conflict)', async () => {
    const inFlow = {
      id: 8,
      account_id: 42,
      amount: AMOUNT_S,
      purpose: null,
      date: DATE_RECENT,
      other_party: 'In-Flow Party',
      transaction_type: null,
      category: 'UNKNOWN',
      note: null,
    }
    const free = { ...inFlow, id: 9, other_party: 'Free Party' }
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/transactions/search')
        ? [inFlow, free]
        : { id: 7, account_id: 42, flow_members: [inFlow] }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Free Party')).toBeInTheDocument()
    expect(screen.queryByText('In-Flow Party')).toBeNull()
  })

  it('propagates the link params on each result row link', async () => {
    mockFetchOnce([
      {
        id: 8,
        account_id: 43,
        amount: AMOUNT_S,
        purpose: null,
        date: DATE_RECENT,
        other_party: 'Candidate Party',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({
      search: { account_ids: [42, 43], link_account_id: 42, link_transaction_id: 7 },
    })

    const row = await screen.findByText('Candidate Party')
    expect(row.closest('a')).toHaveAttribute(
      'href',
      '/transactions/8?link_account_id=42&link_transaction_id=7',
    )
  })

  it('does not leak the link params into the emitted filters', async () => {
    const { onChange } = renderView({
      search: { link_account_id: 42, link_transaction_id: 7 },
    })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const filters = lastPayload(onChange)?.filters ?? {}
    expect(filters.link_account_id).toBeUndefined()
    expect(filters.link_transaction_id).toBeUndefined()
  })
})

describe('TransactionSearchView — request building', () => {
  it('hits /api/transactions/search with account_ids + filter query string', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    renderView({
      search: {
        text: 'rewe',
        amount_from: -AMOUNT_L,
        date_from: DATE_YEAR_START,
        transaction_types: ['OUTGOING'],
        linked: 'linked',
        account_ids: [42, 99],
      },
    })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('/api/transactions/search?')
    expect(url).toContain('account_ids=42')
    expect(url).toContain('account_ids=99')
    expect(url).toContain('text=rewe')
    expect(url).toContain(`amount_from=${-AMOUNT_L}`)
    expect(url).toContain(`date_from=${DATE_YEAR_START}`)
    expect(url).toContain('transaction_types=OUTGOING')
    expect(url).toContain('linked=linked')
    expect(url).not.toContain('submitted=')
  })
})
