import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks({
    Link: ({ to, search, children }: { to: string; search: object; children: React.ReactNode }) => (
      <a href={to} data-search={JSON.stringify(search)}>
        {children}
      </a>
    ),
  }),
)

import '@/i18n'
import type { ContractRead } from '@/lib/contract'
import type { CategoryKey } from '@/lib/transaction'
import { jsonResponse, renderWithQuery } from '@/test/helpers'
import { buildContract } from '@/test/statsFixtures'
import { AMOUNT_L, AMOUNT_M, AMOUNT_S, AMOUNT_XL, CONTRACT_NAME_GYM, money } from '@/test/constants'
import { ContractsSummaryCard } from '../contracts-summary-card'

function contract(
  overrides: Partial<ContractRead> & { perDay: number | null; monthly?: number; yearly?: number },
): ContractRead {
  const { perDay, monthly = 0, yearly = 0, ...rest } = overrides
  return buildContract({
    category: 'HEALTH_INSURANCE',
    median_amount: null,
    amount_per_day: perDay,
    amount_per_frequency:
      perDay === null
        ? null
        : { WEEKLY: 0, BIWEEKLY: 0, MONTHLY: monthly, QUARTERLY: 0, YEARLY: yearly },
    ...rest,
  })
}

const contracts: ContractRead[] = [
  contract({ id: 1, perDay: -AMOUNT_S, monthly: -AMOUNT_L, yearly: -AMOUNT_XL }),
  contract({
    id: 2,
    name: CONTRACT_NAME_GYM,
    category: 'SALARY',
    perDay: AMOUNT_S,
    monthly: AMOUNT_XL,
    yearly: AMOUNT_XL * 12,
  }),
  contract({ id: 3, perDay: null }),
  contract({ id: 4, category: null, perDay: -AMOUNT_M, monthly: -AMOUNT_M }),
  contract({ id: 5, account_id: 99, perDay: -AMOUNT_XL, monthly: -AMOUNT_XL }),
]

function renderCard(categories: CategoryKey[], body: ContractRead[] = contracts) {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => jsonResponse({ status: 200, body }))
  renderWithQuery(<ContractsSummaryCard accountIds={[42]} categories={categories} />)
  return fetchSpy
}

const row = (label: string) => screen.getByText(label).closest('tr')!
const cells = (label: string) =>
  within(row(label))
    .getAllByRole('cell')
    .map((cell) => cell.textContent?.replace(/\u00a0/g, ' '))

function linkSearch() {
  const link = screen.getByRole('link', { name: 'View all' })
  expect(link).toHaveAttribute('href', '/contracts')
  return JSON.parse(link.dataset.search!)
}

describe('ContractsSummaryCard', () => {
  it('sums expenses, income and their balance per day, month and year', async () => {
    const fetchSpy = renderCard(['HEALTH_INSURANCE', 'SALARY'])

    await screen.findByText('Sum')
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/contracts')
    expect(cells('Expenses')).toEqual([money(-AMOUNT_S), money(-AMOUNT_L), money(-AMOUNT_XL)])
    expect(cells('Income')).toEqual([money(AMOUNT_S), money(AMOUNT_XL), money(AMOUNT_XL * 12)])
    expect(cells('Sum')).toEqual([
      money(0),
      money(AMOUNT_XL - AMOUNT_L),
      money(AMOUNT_XL * 12 - AMOUNT_XL),
    ])
  })

  it('colours losses red, gains green and a break-even neutral', async () => {
    renderCard(['HEALTH_INSURANCE', 'SALARY'])
    await screen.findByText('Sum')

    const [expensesPerDay] = within(row('Expenses')).getAllByRole('cell')
    const [incomePerDay] = within(row('Income')).getAllByRole('cell')
    const [sumPerDay, sumPerMonth] = within(row('Sum')).getAllByRole('cell')
    expect(expensesPerDay).toHaveClass('text-destructive')
    expect(incomePerDay).toHaveClass('text-success')
    expect(sumPerDay).not.toHaveClass('text-destructive')
    expect(sumPerDay).not.toHaveClass('text-success')
    expect(sumPerMonth).toHaveClass('text-success')
  })

  it('also counts uncategorized contracts while every category is selected', async () => {
    renderCard([])
    await screen.findByText('Sum')

    expect(cells('Expenses')[0]).toBe(money(-AMOUNT_S - AMOUNT_M))
  })

  it('links to the contract list with the same accounts and categories', async () => {
    renderCard(['HEALTH_INSURANCE', 'SALARY'])

    expect(linkSearch()).toEqual({ account_ids: [42], categories: ['HEALTH_INSURANCE', 'SALARY'] })
  })

  it('leaves the category filter off the link while every category is selected', () => {
    renderCard([])

    expect(linkSearch()).toEqual({ account_ids: [42] })
  })

  it('shows loading until the contracts arrive, then says when none match', async () => {
    renderCard(['RENT'])

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('No contracts match your filters.')).toBeInTheDocument()
  })
})
