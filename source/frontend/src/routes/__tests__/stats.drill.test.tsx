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
import { type StatsDrilldown, type StatsSearchParams } from '@/routes/stats'
import { ACCOUNT_NAME_GIRO, AMOUNT_M, AMOUNT_S, PARTY_SUPERMARKET } from '@/test/constants'
import { renderWithQuery } from '@/test/helpers'
import { buildAccount, buildCredential, fakeHref, hrefArgs } from '@/test/statsFixtures'

const credentials = [
  buildCredential([
    buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO }),
    buildAccount({ id: 99, name: 'Depot', is_market_valued: true }),
  ]),
]

const CHART_ARROWS = 'svg .stats-drill-arrow'

async function renderAndGetArrows(search: Partial<StatsSearchParams>) {
  const onChange = vi.fn()
  const { container } = renderWithQuery(
    <StatsView
      credentials={credentials}
      search={search as StatsSearchParams}
      onChange={onChange}
      searchHref={fakeHref('search')}
      dayHref={fakeHref('day')}
      rangeHref={fakeHref('range')}
      balanceHref={fakeHref('balance')}
    />,
  )
  await waitFor(() => expect(container.querySelectorAll(CHART_ARROWS).length).toBe(2))
  return { onChange, arrows: container.querySelectorAll(CHART_ARROWS) }
}

const drillOf = (arrow: Element) => hrefArgs(arrow.getAttribute('href'))[0] as StatsDrilldown

async function drillIntoFuel(arrows: NodeListOf<Element>) {
  fireEvent.click(arrows[0]) // the Mobility group opens in place
  expect(await screen.findByText('Mobility')).toBeInTheDocument()
  return drillOf(document.querySelectorAll(CHART_ARROWS)[0])
}

describe('StatsView drill-in carries the active filters', () => {
  it('passes the clicked category plus the active type filter', async () => {
    const { arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
    })

    const drill = await drillIntoFuel(arrows)

    expect(drill.categories).toEqual(['FUEL'])
    expect(drill.transactionTypes).toEqual(['FEES'])
  })

  it('passes the party plus the active type filter', async () => {
    const { arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
    })

    const drill = drillOf(arrows[1]) // top recipients

    expect(drill.text).toBe(PARTY_SUPERMARKET)
    expect(drill.transactionTypes).toEqual(['FEES'])
  })

  it('carries the selected category subset into the party drill', async () => {
    const { arrows } = await renderAndGetArrows({ categories: ['FUEL'] })

    const drill = drillOf(arrows[1]) // top recipients

    expect(drill.text).toBe(PARTY_SUPERMARKET)
    expect(drill.categories).toEqual(['FUEL'])
  })

  it('omits the category in the party drill when all categories are selected', async () => {
    const { arrows } = await renderAndGetArrows({})

    expect(drillOf(arrows[1]).categories).toEqual([])
  })

  it('drops market-valued depot accounts from the drill so its list sums to the stat', async () => {
    const { arrows } = await renderAndGetArrows({ account_ids: [42, 99] })

    expect((await drillIntoFuel(arrows)).accountIds).toEqual([42])
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
