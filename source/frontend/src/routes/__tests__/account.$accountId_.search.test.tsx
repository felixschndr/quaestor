import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'

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
}))

import {
  TransactionSearchView,
  type TransactionSearchParams,
} from '@/routes/account.$accountId_.search'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function renderView(opts: { search?: Partial<TransactionSearchParams> } = {}) {
  const onSubmit = vi.fn()
  renderWithClient(
    <TransactionSearchView
      accountId={42}
      search={(opts.search ?? {}) as TransactionSearchParams}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit }
}

describe('TransactionSearchView — form', () => {
  it('renders all filter fields', () => {
    renderView()
    expect(screen.getByLabelText('Search text')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount from')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount to')).toBeInTheDocument()
    // Date pickers render as buttons (Popover triggers), not <input>s —
    // two of them, one per date field.
    const dateTriggers = screen.getAllByRole('button', { name: 'Pick a date' })
    expect(dateTriggers).toHaveLength(2)
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
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
    // Default sign is positive ("+"); flip to negative on the matching toggle.
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].amount_from).toBe(-12.5)
  })

  it('sign toggle round-trips back to positive', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    const amountFromGroup = screen.getByLabelText('Amount from').parentElement!
    await user.type(screen.getByLabelText('Amount from'), '7')
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make negative' }))
    // After flipping once, the button now offers the opposite action.
    await user.click(within(amountFromGroup).getByRole('button', { name: 'Make positive' }))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit.mock.calls[0][0].amount_from).toBe(7)
  })

  it('renders translated labels for the transaction type select', () => {
    renderView()
    const select = screen.getByLabelText('Type') as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.textContent)
    expect(labels).toContain('Incoming')
    expect(labels).toContain('Outgoing')
    expect(labels).toContain('Dividend')
    // raw enum names must not leak into the visible labels
    expect(labels).not.toContain('INCOMING')
  })

  it('renders a Popover-based date picker (consistent UI across browsers, esp. macOS Chrome)', () => {
    renderView()
    const dateTriggers = screen.getAllByRole('button', { name: 'Pick a date' })
    expect(dateTriggers).toHaveLength(2)
    // Triggers carry the labels via their <Label htmlFor=…> association.
    expect(screen.getByText('From date')).toBeInTheDocument()
    expect(screen.getByText('To date')).toBeInTheDocument()
  })

  it('back button links to the account detail page', () => {
    renderView()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/account/42')
  })

  it('submits only the fields the user actually filled in', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderView()

    await user.type(screen.getByLabelText('Search text'), 'rewe')
    await user.type(screen.getByLabelText('Amount from'), '-50')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.text).toBe('rewe')
    expect(payload.amount_from).toBe(-50)
    expect(payload.amount_to).toBeUndefined()
    expect(payload.transaction_type).toBeUndefined()
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
    renderView({ search: { text: 'no match', submitted: '1' } })
    expect(await screen.findByText('No transactions match your filters.')).toBeInTheDocument()
  })

  it('renders one row per returned transaction with the right link and colour', async () => {
    mockFetchOnce([
      {
        id: 1,
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
        amount: 2500,
        purpose: 'Gehalt',
        date: '2026-04-30',
        other_party: 'ACME',
        transaction_type: 'INCOMING',
        category: 'SALARY',
        note: null,
      },
    ])
    renderView({ search: { text: 'a', submitted: '1' } })

    expect(await screen.findByText('Rewe')).toBeInTheDocument()
    expect(screen.getByText('ACME')).toBeInTheDocument()
    const negative = screen.getByText('-42,50 €')
    expect(negative.className).toMatch(/text-destructive/)
    const positive = screen.getByText('2.500,00 €')
    expect(positive.className).toMatch(/text-success/)
    expect(screen.getByText('Rewe').closest('a')).toHaveAttribute(
      'href',
      '/account/42/transactions/1',
    )
  })

  it('falls back to "Unknown" when other_party is missing', async () => {
    mockFetchOnce([
      {
        id: 1,
        amount: -1,
        purpose: 'x',
        date: '2026-05-20',
        other_party: null,
        transaction_type: null,
        category: 'UNKNOWN',
        note: null,
      },
    ])
    renderView({ search: { text: 'a', submitted: '1' } })
    // "Unknown" also appears in the type/category select options, so scope
    // the assertion to the results list.
    const list = await screen.findByRole('list')
    expect(within(list).getByText('Unknown')).toBeInTheDocument()
  })

  it('shows the loading indicator while fetching', () => {
    // Never-resolving fetch keeps the query in loading state.
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch
    renderView({ search: { text: 'a', submitted: '1' } })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('TransactionSearchView — request building', () => {
  it('hits the correct URL with the filter query string', async () => {
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
        transaction_type: 'OUTGOING',
        submitted: '1',
      },
    })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain('/api/account/42/transactions?')
    expect(url).toContain('text=rewe')
    expect(url).toContain('amount_from=-100')
    expect(url).toContain('date_from=2026-01-01')
    expect(url).toContain('transaction_type=OUTGOING')
    expect(url).not.toContain('submitted=')
  })
})
