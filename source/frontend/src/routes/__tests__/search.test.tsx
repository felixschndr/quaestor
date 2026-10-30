import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'
import {
  ACCOUNT_NAME_BROKER,
  ACCOUNT_NAME_DAY,
  ACCOUNT_NAME_GIRO,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATE_MID_MONTH,
  DATE_RECENT,
  DATE_YEAR_START,
  DATE_YESTERDAY,
  LABEL_GROCERIES,
  LABEL_SALARY,
  PARTY_SUPERMARKET,
  money,
} from '@/test/constants'

const searchRoute = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useNavigate: () => searchRoute.navigate,
    useRouter: () => ({ history: { back: vi.fn() } }),
    useCanGoBack: () => false,
  }),
)

vi.mock('@/lib/accountGroups', () => ({
  useAccountGroupLayout: () => ({ data: undefined }),
}))

import { type TransactionSearchParams } from '@/lib/transactionSearchParams'
import { TransactionSearchView } from '@/pages/search'
import { Route } from '@/routes/search'
import { selectFromPopover } from '@/test/popover-select'
import { routeState } from './-routerMock'
import { buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'

const credentials = [
  buildCredential([
    buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO }),
    buildAccount({ id: 43, name: ACCOUNT_NAME_DAY }),
  ]),
  buildCredential([buildAccount({ id: 99, name: ACCOUNT_NAME_BROKER, is_archived: true })], {
    id: 2,
    bank: 'trade_republic',
  }),
]

function transaction(
  id: number,
  amount: number,
  party: string | null,
  overrides: Partial<TransactionRead> = {},
): TransactionRead {
  return {
    id,
    account_id: 42,
    amount,
    purpose: null,
    date: DATE_RECENT,
    other_party: party,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    ...overrides,
  }
}

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 200, body }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  mockFetchOnce([])
})

type ChangePayload = { accountIds: number[]; filters: TransactionFiltersLike }
type TransactionFiltersLike = Record<string, unknown>

function renderView(opts: { search?: Partial<TransactionSearchParams> } = {}) {
  const onChange = vi.fn()
  const onSortChange = vi.fn()
  renderWithQuery(
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
    expect(screen.getByLabelText('Related transactions')).toBeInTheDocument()
  })

  it('searches automatically — there is no submit button', () => {
    const { onChange } = renderView()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    expect(onChange).toHaveBeenCalled()
  })

  it('emits the selected transfer (linked) filter', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Related transactions'))
    await user.click(document.getElementById('related-unlinked')!)

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
    expect(screen.getByLabelText('Related transactions').textContent).toContain('Linked')
  })

  it('renders translated labels for the transaction type options', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Type'))
    expect(screen.getByText('Incoming')).toBeInTheDocument()
    expect(screen.getByText('Outgoing')).toBeInTheDocument()
    expect(screen.queryByText('INCOMING')).toBeNull()
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

  it('emits the upper amount bound', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.type(screen.getByLabelText('Amount to'), String(AMOUNT_L))

    await waitFor(() => expect(lastPayload(onChange)?.filters.amount_to).toBe(AMOUNT_L))
  })

  it('emits the dates picked in the calendar', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView({ search: { date_from: DATE_MID_MONTH, date_to: DATE_RECENT } })

    await user.click(screen.getByLabelText('From date'))
    await user.click(screen.getByRole('button', { name: /May 1st, 2026/ }))
    await user.click(screen.getByLabelText('To date'))
    await user.click(screen.getByRole('button', { name: /May 22nd, 2026/ }))

    await waitFor(() =>
      expect(lastPayload(onChange)?.filters).toMatchObject({
        date_from: '2026-05-01',
        date_to: '2026-05-22',
      }),
    )
  })

  it('narrows the transaction types, and drops the filter again once all are picked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Type'))
    await user.click(screen.getByRole('button', { name: 'None' }))
    await waitFor(() => expect(lastPayload(onChange)?.filters.transaction_types).toEqual([]))
    expect(screen.getByText('No transactions match your filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() =>
      expect(lastPayload(onChange)?.filters).toHaveProperty('transaction_types', undefined),
    )
  })

  it('narrows the categories, and drops the filter again once all are picked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Categories'))
    await user.click(screen.getByRole('button', { name: 'None' }))
    await waitFor(() => expect(lastPayload(onChange)?.filters.categories).toEqual([]))

    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() =>
      expect(lastPayload(onChange)?.filters).toHaveProperty('categories', undefined),
    )
  })

  it('emits the selected attachment filter', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView()

    await user.click(screen.getByLabelText('Attachment'))
    await user.click(document.getElementById('attachment-without')!)

    await waitFor(() => expect(lastPayload(onChange)?.filters.has_attachment).toBe('with'))
  })

  it('resets the filters to the ones the page was opened with', async () => {
    const user = userEvent.setup()
    const { onChange } = renderView({ search: { text: 'gehalt' } })
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull()

    await user.type(screen.getByLabelText('Search text'), ' mai')
    await waitFor(() => expect(lastPayload(onChange)?.filters.text).toBe('gehalt mai'))
    await user.click(screen.getByRole('button', { name: 'Reset filters' }))

    expect(screen.getByLabelText('Search text')).toHaveValue('gehalt')
    await waitFor(() => expect(lastPayload(onChange)?.filters.text).toBe('gehalt'))
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull()
  })

  it('keeps the page when Enter is pressed in the form', () => {
    renderView()
    const form = screen.getByLabelText('Search text').closest('form')!

    const submit = createEvent.submit(form)
    fireEvent(form, submit)

    expect(submit.defaultPrevented).toBe(true)
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

  it('lists archived accounts last under their own heading', async () => {
    const user = userEvent.setup()
    renderView()

    await user.click(screen.getByLabelText('Accounts'))

    const archived = screen.getByRole('heading', { name: 'Archived' }).closest('li')!
    expect(within(archived).getByText(ACCOUNT_NAME_BROKER)).toBeInTheDocument()
    expect(within(archived).queryByText(ACCOUNT_NAME_GIRO)).toBeNull()
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
  it('renders an empty-state message when the backend returns no matches', async () => {
    mockFetchOnce([])
    renderView({ search: { text: 'no match', account_ids: [42] } })
    expect(await screen.findByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it.each([
    ['category', { categories: [] }],
    ['type', { transaction_types: [] }],
  ])('shows no results and does not search when no %s is selected', async (_label, filter) => {
    const fetchSpy = mockFetchOnce([])

    renderView({ search: { account_ids: [42], ...filter } })

    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    expect(screen.getByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('renders one row per returned transaction with the right link and colour', async () => {
    mockFetchOnce([
      transaction(1, -AMOUNT_M, PARTY_SUPERMARKET, {
        purpose: LABEL_GROCERIES,
        transaction_type: 'OUTGOING',
        category: 'SUPERMARKET',
      }),
      transaction(2, AMOUNT_XL, 'ACME', {
        purpose: LABEL_SALARY,
        date: '2026-04-30',
        transaction_type: 'INCOMING',
        category: 'SALARY',
      }),
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
      transaction(1, -AMOUNT_S, PARTY_SUPERMARKET, { purpose: 'x' }),
      transaction(2, -AMOUNT_M, 'Aldi', { account_id: 43, purpose: 'y', date: DATE_YESTERDAY }),
    ])
    renderView({ search: { account_ids: [42, 43] } })

    // Each row's subtitle (date + account name) should mention the account.
    expect(await screen.findByText(new RegExp(ACCOUNT_NAME_GIRO))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(ACCOUNT_NAME_DAY))).toBeInTheDocument()
  })

  it('names a transaction without counterparty "Unknown"', async () => {
    mockFetchOnce([transaction(3, -AMOUNT_S, null)])
    renderView({ search: { account_ids: [42] } })

    expect(await screen.findByText('Unknown')).toBeInTheDocument()
  })

  it('links each result row to its own account, not to the anchor', async () => {
    mockFetchOnce([transaction(7, AMOUNT_S, 'Other', { account_id: 99, purpose: 'x' })])
    renderView({ search: { account_ids: [42, 99] } })

    const link = await screen.findByText('Other')
    expect(link.closest('a')).toHaveAttribute('href', '/transactions/7')
  })
})

describe('TransactionSearchView — link mode', () => {
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
      transaction(7, -AMOUNT_S, 'Source Party', { purpose: 'source' }),
      transaction(8, AMOUNT_S, 'Candidate Party', { purpose: 'candidate' }),
    ])
    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Candidate Party')).toBeInTheDocument()
    expect(screen.queryByText('Source Party')).toBeNull()
  })

  it('excludes pending transactions from the results (they cannot be linked)', async () => {
    mockFetchOnce([
      transaction(8, AMOUNT_S, 'Booked Party', { purpose: 'booked', pending: false }),
      transaction(9, AMOUNT_S, 'Pending Party', { purpose: 'pending', pending: true }),
    ])
    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Booked Party')).toBeInTheDocument()
    expect(screen.queryByText('Pending Party')).toBeNull()
  })

  it('excludes transactions already in the source group (linking them again would conflict)', async () => {
    const inGroup = transaction(8, AMOUNT_S, 'In-Group Party')
    const free = transaction(9, AMOUNT_S, 'Free Party')
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = url.includes('/transactions/search')
        ? [inGroup, free]
        : { id: 7, account_id: 42, related_transactions: [inGroup] }
      return Promise.resolve(jsonResponse({ status: 200, body }))
    }) as unknown as typeof fetch

    renderView({
      search: { account_ids: [42], link_account_id: 42, link_transaction_id: 7 },
    })

    expect(await screen.findByText('Free Party')).toBeInTheDocument()
    expect(screen.queryByText('In-Group Party')).toBeNull()
  })

  it('propagates the link params on each result row link', async () => {
    mockFetchOnce([transaction(8, AMOUNT_S, 'Candidate Party', { account_id: 43 })])
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
    const fetchSpy = mockFetchOnce([])

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

describe('search route', () => {
  const SearchPage = Route.options.component!

  beforeEach(() => {
    routeState.search = {}
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/auth/me'
          ? jsonResponse({ status: 200, body: buildUser({ credentials }) })
          : jsonResponse({
              status: 200,
              body: [
                transaction(1, -AMOUNT_S, PARTY_SUPERMARKET),
                transaction(2, AMOUNT_L, 'ACME'),
              ],
            }),
      ),
    ) as unknown as typeof fetch
  })

  const lastNavigation = () => searchRoute.navigate.mock.calls.at(-1)?.[0]

  it('reads one or many account ids from the URL', () => {
    const parse = Route.options.validateSearch as (search: object) => TransactionSearchParams
    expect(parse({ account_ids: '42' }).account_ids).toEqual([42])
    expect(parse({ account_ids: ['42', '99'] }).account_ids).toEqual([42, 99])
  })

  it('shows the search once the user is known', async () => {
    const { container } = renderWithQuery(<SearchPage />)
    expect(container).toBeEmptyDOMElement()

    expect(await screen.findByLabelText('Search text')).toBeInTheDocument()
  })

  it('mirrors the filters into the URL, leaving the default accounts out', async () => {
    const user = userEvent.setup()
    routeState.search = { link_account_id: 42, link_transaction_id: 7, sort: 'amount_asc' }
    renderWithQuery(<SearchPage />)

    await user.type(await screen.findByLabelText('Search text'), 'rewe')

    await waitFor(() => expect(lastNavigation()?.search.text).toBe('rewe'))
    expect(lastNavigation()).toEqual({
      search: {
        text: 'rewe',
        account_ids: undefined,
        link_account_id: 42,
        link_transaction_id: 7,
        sort: 'amount_asc',
      },
      replace: true,
    })
  })

  it('keeps a narrowed account selection in the URL', async () => {
    routeState.search = { account_ids: [42] }
    renderWithQuery(<SearchPage />)

    await waitFor(() => expect(lastNavigation()?.search.account_ids).toEqual([42]))
  })

  it('stores a chosen sort in the URL and drops it again for the default', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithQuery(<SearchPage />)
    await screen.findByText('ACME')

    await selectFromPopover(user, 'Sort', 'Amount: low to high')
    expect(lastNavigation()).toEqual({
      search: expect.objectContaining({ sort: 'amount_asc' }),
      replace: true,
    })

    routeState.search = { sort: 'amount_asc' }
    rerender(<SearchPage />)
    await selectFromPopover(user, 'Sort', 'Newest first')
    expect(lastNavigation()).toEqual({
      search: expect.objectContaining({ sort: undefined }),
      replace: true,
    })
  })
})
