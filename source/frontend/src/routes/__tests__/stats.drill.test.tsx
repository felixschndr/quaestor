import { cloneElement, type ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
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
      return Promise.resolve([{ category: 'FUEL', total: 10 }])
    }
    if (path.includes('/statistics/other-parties')) {
      return Promise.resolve([{ other_party: 'Rewe', total: 20 }])
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
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
}))

import '@/i18n'
import type { CredentialRead } from '@/lib/auth'
import { StatsView, type StatsSearchParams } from '@/routes/stats'

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
    ],
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
  },
]

async function renderAndGetArrows(search: Partial<StatsSearchParams>) {
  const onOpenSearch = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <StatsView
        credentials={credentials}
        search={search as StatsSearchParams}
        onChange={vi.fn()}
        onOpenSearch={onOpenSearch}
        onOpenDay={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await waitFor(() =>
    expect(container.querySelectorAll('.stats-drill-arrow[role="button"]').length).toBe(2),
  )
  return {
    onOpenSearch,
    arrows: container.querySelectorAll('.stats-drill-arrow[role="button"]'),
  }
}

describe('StatsView drill-in carries the active filters', () => {
  it('passes the clicked category plus the active type and transfer filters', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
      linked: 'linked',
    })

    fireEvent.click(arrows[0]) // the "By category" bar

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.categories).toEqual(['FUEL'])
    expect(drill.transactionTypes).toEqual(['FEES'])
    expect(drill.linked).toBe('linked')
  })

  it('passes the party plus the active type and transfer filters', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({
      transaction_types: ['FEES'],
      linked: 'linked',
    })

    fireEvent.click(arrows[1]) // top recipients

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.text).toBe('Rewe')
    expect(drill.transactionTypes).toEqual(['FEES'])
    expect(drill.linked).toBe('linked')
  })

  it('carries the selected category subset into the party drill', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({ categories: ['FUEL'] })

    fireEvent.click(arrows[1]) // top recipients

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.text).toBe('Rewe')
    expect(drill.categories).toEqual(['FUEL'])
  })

  it('omits the category in the party drill when all categories are selected', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({})

    fireEvent.click(arrows[1])

    expect(onOpenSearch.mock.calls.at(-1)?.[0].categories).toEqual([])
  })

  it('defaults the transfer drill to "unlinked" (Keine Umbuchung) with no URL filter', async () => {
    const { onOpenSearch, arrows } = await renderAndGetArrows({})

    fireEvent.click(arrows[0])

    const drill = onOpenSearch.mock.calls.at(-1)?.[0]
    expect(drill.transactionTypes).toEqual([])
    expect(drill.linked).toBe('unlinked')
  })
})
