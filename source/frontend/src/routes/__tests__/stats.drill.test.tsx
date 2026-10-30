import { cloneElement, type ReactElement } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>
    }) => cloneElement(children, { width: 400, height: 300 }),
  }
})

vi.mock('@/lib/api', () => ({
  api: vi.fn((path: string) => {
    if (path.includes('/statistics/categories')) {
      return Promise.resolve([{ category: 'FUEL', total: AMOUNT_S }])
    }
    if (path.includes('/statistics/other-parties')) {
      return Promise.resolve([{ other_party: PARTY_SUPERMARKET, total: AMOUNT_M }])
    }
    if (path.includes('/net-worth')) return Promise.resolve({ series: [], summary: null })
    return Promise.resolve([])
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'children'
  >) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useCanGoBack: () => false,
  useRouter: () => ({ history: { back: () => {}, push: () => {} } }),
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
}))

import '@/i18n'
import { StatsView } from '@/pages/stats'
import { type StatsSearchParams } from '@/routes/stats'
import { ACCOUNT_NAME_GIRO, AMOUNT_M, AMOUNT_S, PARTY_SUPERMARKET } from '@/test/constants'
import { renderWithQuery } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'

const credentials = [
  buildCredential([
    buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO }),
    buildAccount({ id: 99, name: 'Depot', is_market_valued: true }),
  ]),
]

async function renderAndGetArrows(search: Partial<StatsSearchParams>) {
  const onOpenSearch = vi.fn()
  const onChange = vi.fn()
  const { container } = renderWithQuery(
    <StatsView
      credentials={credentials}
      search={search as StatsSearchParams}
      onChange={onChange}
      onOpenSearch={onOpenSearch}
      onOpenDay={vi.fn()}
      onOpenRange={vi.fn()}
      onOpenBalance={vi.fn()}
    />,
  )
  await waitFor(() =>
    expect(container.querySelectorAll('.stats-drill-arrow[role="button"]').length).toBe(2),
  )
  return {
    onOpenSearch,
    onChange,
    arrows: container.querySelectorAll('.stats-drill-arrow[role="button"]'),
  }
}

async function drillIntoFuel(arrows: NodeListOf<Element>) {
  fireEvent.click(arrows[0])
  expect(await screen.findByText('Mobility')).toBeInTheDocument()
  fireEvent.click(document.querySelectorAll('.stats-drill-arrow[role="button"]')[0])
}

describe('StatsView drill-in carries the active filters', () => {
  it('passes the clicked category plus the active type filter', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
    })

    await drillIntoFuel(arrows)

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.categories).toEqual(['FUEL'])
    expect(drill.transactionTypes).toEqual(['FEES'])
  })

  it('passes the party plus the active type filter', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
    })

    fireEvent.click(arrows[1]) // top recipients

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.text).toBe(PARTY_SUPERMARKET)
    expect(drill.transactionTypes).toEqual(['FEES'])
  })

  it('carries the selected category subset into the party drill', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({ categories: ['FUEL'] })

    fireEvent.click(arrows[1]) // top recipients

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.text).toBe(PARTY_SUPERMARKET)
    expect(drill.categories).toEqual(['FUEL'])
  })

  it('omits the category in the party drill when all categories are selected', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({})

    fireEvent.click(arrows[1])

    expect(onOpenSearch.mock.calls.at(-1)?.[0].categories).toEqual([])
  })

  it('drops market-valued depot accounts from the drill so its list sums to the stat', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({ account_ids: [42, 99] })

    await drillIntoFuel(arrows)

    expect(onOpenSearch.mock.calls.at(-1)?.[0].accountIds).toEqual([42])
  })
})

describe('StatsView hides chart rows from their axis label', () => {
  it('hides a category group', async () => {
    const { onChange } = await renderAndGetArrows({})
    fireEvent.click(screen.getByText('Mobility'))
    expect(onChange.mock.calls.at(-1)?.[0].hiddenCategories).toEqual(['MOBILITY'])
  })

  it('shows a hidden category group again', async () => {
    const { onChange } = await renderAndGetArrows({ hidden_categories: ['MOBILITY'] })
    fireEvent.click(screen.getByText('Mobility'))
    expect(onChange.mock.calls.at(-1)?.[0].hiddenCategories).toEqual([])
  })

  it('hides a party', async () => {
    const { onChange } = await renderAndGetArrows({})
    fireEvent.click(screen.getByText(PARTY_SUPERMARKET))
    expect(onChange.mock.calls.at(-1)?.[0].hiddenParties).toEqual([PARTY_SUPERMARKET])
  })

  it('shows a hidden party again', async () => {
    const { onChange } = await renderAndGetArrows({ hidden_parties: [PARTY_SUPERMARKET] })
    fireEvent.click(screen.getByText(PARTY_SUPERMARKET))
    expect(onChange.mock.calls.at(-1)?.[0].hiddenParties).toEqual([])
  })
})
