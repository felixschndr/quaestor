import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { BankPickerView } from '@/pages/settings.credentials.new.index'
import type { SupportedBank } from '@/lib/credentials'

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
    // "Stadtsparkasse München" is tested → badge present
    expect(screen.getByText('Verified')).toBeInTheDocument()
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
})
