import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

import { BankPickerView } from '@/pages/settings.credentials.new.index'
import { Route } from '@/routes/settings.credentials.new.index'
import type { SupportedBank } from '@/lib/credentials'
import type { CredentialRead } from '@/lib/auth'
import { routeState } from './-routerMock'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { TEST_IBAN_BRANCH_BLZ } from '@/test/constants'

function StatefulPicker({
  isLoading = false,
  isError = false,
  banks,
  existingAccountCounts = {},
}: {
  isLoading?: boolean
  isError?: boolean
  banks: SupportedBank[]
  existingAccountCounts?: Record<string, number>
}) {
  const [query, setQuery] = useState('')
  return (
    <BankPickerView
      isLoading={isLoading}
      isError={isError}
      banks={banks}
      existingAccountCounts={existingAccountCounts}
      query={query}
      onSearch={setQuery}
    />
  )
}

const BANKS: SupportedBank[] = [
  {
    provider: 'fints',
    key: '70150000',
    name: 'Stadtsparkasse München',
    bic: null,
    icon: '/static/banks/sparkasse.png',
    tested: true,
    required_fields: ['username', 'password'],
    blzs: ['70150000'],
  },
  {
    provider: 'fints',
    key: '10070000',
    name: 'Deutsche Bank',
    bic: null,
    icon: null,
    tested: false,
    required_fields: ['username', 'password'],
    blzs: ['10070000', '12070000'],
  },
  {
    provider: 'manual',
    key: 'manual',
    name: 'manual',
    bic: null,
    icon: '/static/banks/manual.png',
    tested: false,
    required_fields: [],
    blzs: [],
  },
]

// The searchable catalog without the pinned "manual" entry, for tests that assert exact
// row counts of the filtered list.
const CATALOG = BANKS.filter((bank) => bank.provider !== 'manual')

describe('BankPickerView', () => {
  it('shows the full bank list before any query is entered', () => {
    render(
      <StatefulPicker isLoading={false} isError={false} banks={BANKS} existingAccountCounts={{}} />,
    )
    // The list is always visible (scrollable) — every bank is rendered, no search needed.
    expect(screen.getAllByRole('listitem')).toHaveLength(BANKS.length)
    expect(screen.getByText('Deutsche Bank')).toBeInTheDocument()
  })

  it('shows the BLZ and BIC under the bank name', () => {
    const banks: SupportedBank[] = [
      {
        provider: 'fints',
        key: '66050101',
        name: 'Sparkasse Pforzheim Calw',
        bic: 'PZHSDE66XXX',
        icon: '/static/banks/sparkasse.png',
        tested: true,
        required_fields: ['username', 'password'],
        blzs: ['66050101'],
      },
    ]
    render(
      <StatefulPicker isLoading={false} isError={false} banks={banks} existingAccountCounts={{}} />,
    )
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('66050101 · PZHSDE66XXX')
  })

  it('shows a handler badge on Enable Banking and FinTS rows', () => {
    const banks: SupportedBank[] = [
      {
        provider: 'enable_banking',
        key: 'eb-FI-Nordea',
        name: 'Nordea',
        bic: null,
        icon: null,
        tested: true,
        required_fields: ['private_key'],
        blzs: [],
        countries: ['FI'],
      },
    ]
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={[...banks, ...CATALOG]}
        existingAccountCounts={{}}
      />,
    )
    expect(screen.getByRole('link', { name: /Nordea/ })).toHaveTextContent('Enable Banking')
    expect(screen.getByRole('link', { name: /Deutsche Bank/ })).toHaveTextContent('FinTS')
  })

  it('hints at extra branch BLZs with a +N suffix', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={CATALOG}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsche' } })
    // Deutsche Bank groups two branch BLZs → "10070000 +1".
    expect(screen.getByRole('listitem')).toHaveTextContent('10070000 +1')
  })

  it('filters banks by name (case-insensitive)', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={CATALOG}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsche' } })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Deutsche Bank')
  })

  it('ignores spacing, hyphens and diacritics when matching names', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={CATALOG}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'stadt-sparkasse munchen' },
    })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Stadtsparkasse München')
  })

  it('filters banks by BLZ prefix', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={CATALOG}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '70150' } })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Stadtsparkasse München')
  })

  it('shows the verified badge only on tested banks', () => {
    render(
      <StatefulPicker isLoading={false} isError={false} banks={BANKS} existingAccountCounts={{}} />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bank' } })
    // "Deutsche Bank" is not tested → no badge
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'stadtsparkasse' } })
    // "Stadtsparkasse München" is tested → badge present (rendered twice: the
    // inline desktop copy and the mobile row, one of them hidden by CSS)
    expect(screen.getAllByText('Verified')).toHaveLength(2)
  })

  it('routes by key: Deutsche Bank link uses key 10070000', () => {
    render(
      <StatefulPicker isLoading={false} isError={false} banks={BANKS} existingAccountCounts={{}} />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsche' } })
    expect(screen.getByRole('link', { name: /Deutsche Bank/ })).toHaveAttribute(
      'href',
      '/settings/credentials/new/10070000',
    )
  })

  it('shows no results message when no banks match', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={CATALOG}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyznotabank' } })
    expect(screen.getByText('No bank found.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('pins the manual account entry at the top, even while searching', () => {
    render(
      <StatefulPicker isLoading={false} isError={false} banks={BANKS} existingAccountCounts={{}} />,
    )
    // First row is the pinned manual entry…
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Manual account')
    // …and it stays available even when the query matches no real bank.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyznotabank' } })
    expect(screen.getByRole('link', { name: /Manual account/ })).toBeInTheDocument()
  })

  it('renders the loading state while the banks query is in flight', () => {
    render(
      <StatefulPicker isLoading={true} isError={false} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders an error message when the query failed', () => {
    render(
      <StatefulPicker isLoading={false} isError={true} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('includes a back link to the credentials list', () => {
    render(
      <StatefulPicker isLoading={false} isError={false} banks={[]} existingAccountCounts={{}} />,
    )
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/settings/credentials',
    )
  })

  it('shows the account count for special providers and omits it for FinTS banks', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        existingAccountCounts={{ manual: 2 }}
        banks={BANKS}
      />,
    )
    // Search for the manual bank (special provider: provider === key)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'manual' } })
    expect(screen.getByRole('link', { name: /Manual account/ })).toHaveTextContent(
      '2 accounts already added',
    )

    // Search for a FinTS bank — no accounts line
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsche' } })
    expect(screen.getByRole('link', { name: /Deutsche Bank/ })).not.toHaveTextContent('account')
  })

  it('shows the account count for a FinTS bank matched by its catalog name', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        existingAccountCounts={{ 'Deutsche Bank': 3 }}
        banks={BANKS}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'deutsche' } })
    expect(screen.getByRole('link', { name: /Deutsche Bank/ })).toHaveTextContent(
      '3 accounts already added',
    )
  })
})

describe('BankPickerView — search and badges', () => {
  it('finds a branch bank by a pasted IBAN', () => {
    render(<StatefulPicker banks={CATALOG} />)
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: TEST_IBAN_BRANCH_BLZ.replace(/(.{4})/g, '$1 ') },
    })
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Deutsche Bank')
  })

  it('matches nothing for a query made only of punctuation', () => {
    render(<StatefulPicker banks={CATALOG} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '--' } })
    expect(screen.getByText('No bank found.')).toBeInTheDocument()
  })

  it('marks directly supported providers and counts their accounts even when none exist', () => {
    const tradeRepublic: SupportedBank = {
      provider: 'trade_republic',
      key: 'trade_republic',
      name: 'Trade Republic',
      bic: null,
      icon: null,
      tested: false,
      required_fields: ['phone', 'pin'],
      blzs: [],
    }
    render(<StatefulPicker banks={[tradeRepublic]} />)
    const row = screen.getByRole('link', { name: /Trade Republic/ })
    expect(row).toHaveTextContent('Direct')
    expect(row).toHaveTextContent('No accounts added yet')
  })

  it('drops the keyboard focus from the search field when the list is scrolled by touch', () => {
    render(<StatefulPicker banks={CATALOG} />)
    const search = screen.getByRole('searchbox')
    search.focus()
    fireEvent.touchMove(window)
    expect(search).not.toHaveFocus()
  })
})

describe('/settings/credentials/new/ route', () => {
  const Page = Route.options.component!

  function credential(overrides: Partial<CredentialRead>): CredentialRead {
    return {
      id: 1,
      bank: 'fints',
      bank_name: null,
      bank_icon: null,
      accounts: [],
      last_successful_sync_timestamp: null,
      requires_two_factor_authentication: false,
      sync_enabled: true,
      ...overrides,
    }
  }

  const account = (id: number) => ({
    id,
    name: `Account ${id}`,
    display_name: null,
    balance: 0,
    balance_factor: 100,
    is_archived: false,
    include_by_default: true,
    is_market_valued: false,
  })

  function serve() {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/credentials/supported_banks') {
        return Promise.resolve(jsonResponse({ status: 200, body: BANKS }))
      }
      if (input === '/api/auth/me') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: buildUser({
              credentials: [
                credential({ id: 1, bank_name: 'Deutsche Bank', accounts: [account(1)] }),
                credential({ id: 2, bank_name: 'Deutsche Bank', accounts: [account(2)] }),
                credential({ id: 3, bank: 'manual', accounts: [account(3)] }),
              ],
            }),
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
    })
  }

  afterEach(() => {
    navigate.mockClear()
    vi.restoreAllMocks()
  })

  it('counts the accounts already added per bank', async () => {
    serve()
    routeState.search = {}
    renderWithQuery(<Page />)

    expect(
      await screen.findByRole('link', { name: /Deutsche Bank.*2 accounts already added/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manual account/ })).toHaveTextContent(
      '1 account already added',
    )
  })

  it('filters by the q search param and writes edits back to the URL', async () => {
    serve()
    routeState.search = { q: 'deutsche' }
    renderWithQuery(<Page />)

    const search = screen.getByRole('searchbox')
    expect(search).toHaveValue('deutsche')
    expect(await screen.findByRole('link', { name: /Deutsche Bank/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Stadtsparkasse/ })).not.toBeInTheDocument()

    await userEvent.type(search, 'x')
    await userEvent.clear(search)

    const [[typed], [cleared]] = navigate.mock.calls
    expect(typed.replace).toBe(true)
    expect(typed.search({ other: '1' })).toEqual({ other: '1', q: 'deutschex' })
    expect(cleared.search({ q: 'deutsche' })).toEqual({ q: undefined })
  })

  it('accepts only a string q search param', () => {
    const validate = Route.options.validateSearch as (search: unknown) => unknown
    expect(validate({ q: 'ing', page: 2 })).toEqual({ q: 'ing' })
    expect(() => validate({ q: 5 })).toThrow()
  })
})
