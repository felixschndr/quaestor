import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

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
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    let href = to
    if (params)
      for (const [key, value] of Object.entries(params)) href = href.replace(`$${key}`, value)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))

import { BankPickerView } from '@/pages/settings.credentials.new.index'
import type { SupportedBank } from '@/lib/credentials'

/** The view is URL-controlled in production; this harness gives it the same state locally
 *  so the existing interaction tests (type, drill in, go back) keep working unchanged. */
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
  const [family, setFamily] = useState<string | null>(null)
  const [familyQuery, setFamilyQuery] = useState('')
  return (
    <BankPickerView
      isLoading={isLoading}
      isError={isError}
      banks={banks}
      existingAccountCounts={existingAccountCounts}
      query={query}
      family={family}
      familyQuery={familyQuery}
      onSearch={setQuery}
      onOpenFamily={(slug) => {
        setFamily(slug)
        setFamilyQuery(query)
      }}
      onCloseFamily={() => setFamily(null)}
      onFamilySearch={setFamilyQuery}
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
    family: { slug: 'sparkasse', label: 'Sparkasse' },
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
    family: null,
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
    family: null,
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
        family: { slug: 'sparkasse', label: 'Sparkasse' },
        blzs: ['66050101'],
      },
    ]
    render(
      <StatefulPicker isLoading={false} isError={false} banks={banks} existingAccountCounts={{}} />,
    )
    const row = screen.getByRole('listitem')
    expect(row).toHaveTextContent('66050101 · PZHSDE66XXX')
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

const FAMILY_LABELS: Record<string, string> = {
  sparkasse: 'Sparkasse',
  volksbank: 'Volksbank Raiffeisenbank',
}

function fintsBank(key: string, name: string, slug: string): SupportedBank {
  return {
    provider: 'fints',
    key,
    name,
    bic: null,
    icon: `/static/banks/${slug}.png`,
    tested: false,
    required_fields: ['username', 'password'],
    family: { slug, label: FAMILY_LABELS[slug] ?? slug },
    blzs: [key],
  }
}

const FAMILY_BANKS: SupportedBank[] = [
  fintsBank('70150000', 'Stadtsparkasse München', 'sparkasse'),
  fintsBank('66050101', 'Sparkasse Pforzheim Calw', 'sparkasse'),
  fintsBank('70090100', 'Münchner Bank', 'volksbank'),
  fintsBank('60190000', 'Volksbank Stuttgart', 'volksbank'),
  {
    provider: 'manual',
    key: 'manual',
    name: 'manual',
    bic: null,
    icon: '/static/banks/manual.png',
    tested: true,
    required_fields: [],
    family: null,
    blzs: [],
  },
]

describe('BankPickerView bank families', () => {
  it('collapses same-logo banks into a single family row', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={FAMILY_BANKS}
        existingAccountCounts={{}}
      />,
    )
    // The family is one row; its individual members are hidden until you drill in.
    expect(screen.getByRole('button', { name: /Sparkasse/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Volksbank Raiffeisenbank/ })).toBeInTheDocument()
    expect(screen.queryByText('Stadtsparkasse München')).not.toBeInTheDocument()
    expect(screen.queryByText('Volksbank Stuttgart')).not.toBeInTheDocument()
    // Standalone providers still render as a normal (link) row.
    expect(screen.getByRole('link', { name: /Manual account/ })).toBeInTheDocument()
  })

  it('opens a family, searches its members, and links to the chosen member by key', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={FAMILY_BANKS}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sparkasse/ }))

    // Both Sparkasse members are now visible; the Volksbank members are not.
    expect(screen.getByText('Stadtsparkasse München')).toBeInTheDocument()
    expect(screen.getByText('Sparkasse Pforzheim Calw')).toBeInTheDocument()
    expect(screen.queryByText('Münchner Bank')).not.toBeInTheDocument()

    // The sub-search filters the family members.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pforzheim' } })
    expect(screen.queryByText('Stadtsparkasse München')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sparkasse Pforzheim Calw/ })).toHaveAttribute(
      'href',
      '/settings/credentials/new/66050101',
    )
  })

  it('carries the search term into the group when opening it', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={FAMILY_BANKS}
        existingAccountCounts={{}}
      />,
    )
    // Search surfaces the Sparkasse family because a member matches.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pforzheim' } })
    fireEvent.click(screen.getByRole('button', { name: /Sparkasse/ }))

    // Inside the group the search is pre-applied — no need to retype it.
    expect(screen.getByRole('searchbox')).toHaveValue('pforzheim')
    expect(screen.getByText('Sparkasse Pforzheim Calw')).toBeInTheDocument()
    expect(screen.queryByText('Stadtsparkasse München')).not.toBeInTheDocument()
  })

  it('returns to the top-level list via the back button', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={FAMILY_BANKS}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Sparkasse/ }))
    expect(screen.getByText('Stadtsparkasse München')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // Back at the top level: the family is a collapsed row again.
    expect(screen.getByRole('button', { name: /Sparkasse/ })).toBeInTheDocument()
    expect(screen.queryByText('Stadtsparkasse München')).not.toBeInTheDocument()
  })

  it('puts a logo-less VR bank into the Volksbank family', () => {
    const banks: SupportedBank[] = [
      ...FAMILY_BANKS,
      // No logo, but the cooperative "VR…" name pulls it into the Volksbank family.
      { ...fintsBank('80063508', 'VR-Bank Altenburger Land', 'volksbank'), icon: null },
    ]
    render(
      <StatefulPicker isLoading={false} isError={false} banks={banks} existingAccountCounts={{}} />,
    )
    // It is not a standalone row at the top level…
    expect(screen.queryByText('VR-Bank Altenburger Land')).not.toBeInTheDocument()
    // …it appears inside the Volksbank family.
    fireEvent.click(screen.getByRole('button', { name: /Volksbank Raiffeisenbank/ }))
    expect(screen.getByText('VR-Bank Altenburger Land')).toBeInTheDocument()
  })

  it('surfaces a family when a member matches a BLZ search at the top level', () => {
    render(
      <StatefulPicker
        isLoading={false}
        isError={false}
        banks={FAMILY_BANKS}
        existingAccountCounts={{}}
      />,
    )
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '66050101' } })
    // The Sparkasse family stays a single row even though the match is a specific member.
    expect(screen.getByRole('button', { name: /Sparkasse/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Volksbank Raiffeisenbank/ }),
    ).not.toBeInTheDocument()
  })
})
