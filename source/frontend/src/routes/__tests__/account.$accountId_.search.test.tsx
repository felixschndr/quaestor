import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'
import type { CredentialRead } from '@/lib/auth'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
  useCanGoBack: () => false,
}))

import {
  TransactionSearchView,
  type TransactionSearchParams,
} from '@/routes/account.$accountId_.search'

const credentials: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 42,
        name: 'Girokonto',
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
      },
      {
        id: 43,
        name: 'Tagesgeld',
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
      },
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
  },
  {
    id: 2,
    bank: 'trade_republic',
    bank_name: null,
    bank_icon: null,
    accounts: [
      {
        id: 99,
        name: 'TR Cash',
        balance: 0,
        balance_factor: 100,
        display_name: null,
        is_hidden: false,
      },
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
  },
]

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function renderView(opts: { search?: Partial<TransactionSearchParams> } = {}) {
  const onSubmit = vi.fn()
  renderWithClient(
    <TransactionSearchView
      anchorAccountId={42}
      credentials={credentials}
      search={(opts.search ?? {}) as TransactionSearchParams}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit }
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

  it('submits the selected transfer (linked) filter', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    // Default is "Any" (both checked); dropping "No transfer" isolates transfers.
    await user.click(screen.getByLabelText('Transfer'))
    await user.click(document.getElementById('transfer-multi-unlinked')!)
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit.mock.calls[0][0].filters.linked).toBe('linked')
  })

  it('omits the transfer filter when left on "Any"', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit.mock.calls[0][0].filters.linked).toBeUndefined()
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
    const { onSubmit } = renderView()

    const amountFromGroup = screen.getByLabelText('Amount from').parentElement!
    await user.type(screen.getByLabelText('Amount from'), '12.5')
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].filters.amount_from).toBe(-12.5)
  })

  it('sign toggle round-trips back to positive', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    const amountFromGroup = screen.getByLabelText('Amount from').parentElement!
    await user.type(screen.getByLabelText('Amount from'), '7')
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make positive' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit.mock.calls[0][0].filters.amount_from).toBe(7)
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

  it('back button links to the account detail page (anchor account)', () => {
    renderView()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/account/42')
  })

  it('submits only the filters the user filled in, plus the selected account ids', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    await user.type(screen.getByLabelText('Search text'), 'rewe')
    await user.type(screen.getByLabelText('Amount from'), '50')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.filters.text).toBe('rewe')
    expect(payload.filters.amount_from).toBe(50)
    expect(payload.filters.amount_to).toBeUndefined()
    // The anchor account is pre-selected by default.
    expect(payload.accountIds).toEqual([42])
  })

  it('preserves the existing URL filters in the form', () => {
    renderView({ search: { text: 'gehalt', amount_from: 100, submitted: '1' } })
    expect((screen.getByLabelText('Search text') as HTMLInputElement).value).toBe('gehalt')
    expect((screen.getByLabelText('Amount from') as HTMLInputElement).value).toBe('100')
  })

  it('does not show the results section until the user submitted at least once', () => {
    renderView()
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })
})

describe('TransactionSearchView — accounts multi-select', () => {
  it('preselects the anchor account by default', () => {
    renderView()
    expect(screen.getByLabelText('Accounts').textContent).toContain('1 account')
  })

  it('lets the user pick more accounts', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    await user.click(screen.getByLabelText('Accounts'))
    // Each account row's checkbox is reachable by the account name.
    const tagesgeldRow = screen.getByText('Tagesgeld').closest('label')!
    await user.click(within(tagesgeldRow).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.accountIds.sort()).toEqual([42, 43])
  })

  it('"All" selects every account', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    await user.click(screen.getByLabelText('Accounts'))
    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const payload = onSubmit.mock.calls[0][0]
    expect(payload.accountIds.sort((a: number, b: number) => a - b)).toEqual([42, 43, 99])
  })

  it('"None" clears the selection and disables the submit button', async () => {
    const user = userEvent.setup()
    renderView()

    await user.click(screen.getByLabelText('Accounts'))
    await user.click(screen.getByRole('button', { name: 'None' }))

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  })

  it('shows the URL-provided account ids when present', () => {
    renderView({ search: { account_ids: [42, 99], submitted: '1' } })
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
    renderView({ search: { text: 'no match', account_ids: [42], submitted: '1' } })
    expect(await screen.findByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('renders one row per returned transaction with the right link and colour', async () => {
    mockFetchOnce([
      {
        id: 1,
        account_id: 42,
        amount: -42.5,
        purpose: 'Wocheneinkauf',
        date: '2026-05-20',
        other_party: 'Rewe',
        transaction_type: 'OUTGOING',
        category: 'SUPERMARKET',
        note: null,
      },
      {
        id: 2,
        account_id: 42,
        amount: 2500,
        purpose: 'Gehalt',
        date: '2026-04-30',
        other_party: 'ACME',
        transaction_type: 'INCOMING',
        category: 'SALARY',
        note: null,
      },
    ])
    renderView({ search: { text: 'a', account_ids: [42], submitted: '1' } })

    expect(await screen.findByText('Rewe')).toBeInTheDocument()
    expect(screen.getByText('ACME')).toBeInTheDocument()
    expect(screen.getByText('-42,50 €').className).toMatch(/text-destructive/)
    expect(screen.getByText('2.500,00 €').className).toMatch(/text-success/)
    expect(screen.getByText('Rewe').closest('a')).toHaveAttribute(
      'href',
      '/account/42/transactions/1',
    )
  })

  it('shows the per-row account name only when more than one account is selected', async () => {
    mockFetchOnce([
      {
        id: 1,
        account_id: 42,
        amount: -10,
        purpose: 'x',
        date: '2026-05-20',
        other_party: 'Rewe',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
      {
        id: 2,
        account_id: 43,
        amount: -20,
        purpose: 'y',
        date: '2026-05-21',
        other_party: 'Aldi',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({ search: { account_ids: [42, 43], submitted: '1' } })

    // Each row's subtitle (date + account name) should mention the account.
    expect(await screen.findByText(/Girokonto/)).toBeInTheDocument()
    expect(screen.getByText(/Tagesgeld/)).toBeInTheDocument()
  })

  it('links each result row to its own account, not to the anchor', async () => {
    mockFetchOnce([
      {
        id: 7,
        account_id: 99, // belongs to TR, while anchorAccountId is 42
        amount: 5,
        purpose: 'x',
        date: '2026-05-20',
        other_party: 'Other',
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({ search: { account_ids: [42, 99], submitted: '1' } })

    const link = await screen.findByText('Other')
    expect(link.closest('a')).toHaveAttribute('href', '/account/99/transactions/7')
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
        amount_from: -100,
        date_from: '2026-01-01',
        transaction_types: ['OUTGOING'],
        linked: 'linked',
        account_ids: [42, 99],
        submitted: '1',
      },
    })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('/api/transactions/search?')
    expect(url).toContain('account_ids=42')
    expect(url).toContain('account_ids=99')
    expect(url).toContain('text=rewe')
    expect(url).toContain('amount_from=-100')
    expect(url).toContain('date_from=2026-01-01')
    expect(url).toContain('transaction_types=OUTGOING')
    expect(url).toContain('linked=linked')
    expect(url).not.toContain('submitted=')
  })
})
