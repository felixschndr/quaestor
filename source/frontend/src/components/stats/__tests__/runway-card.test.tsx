import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { formatMonths } from '@/lib/format'
import type { MonthlyCashflow } from '@/lib/statistics'
import type { CategoryKey } from '@/lib/transaction'
import { jsonResponse, renderWithQuery } from '@/routes/__tests__/-settingsUserTestHelpers'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_XL,
  DATE_YEAR_START,
  money,
} from '@/test/constants'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import { RunwayCard } from '../runway-card'

const credentials = [
  buildCredential([
    buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO, balance: AMOUNT_XL }),
    buildAccount({ id: 43, name: ACCOUNT_NAME_SAVINGS, balance: AMOUNT_XL * 10 }),
  ]),
]

function serveCashflow(response: { status: number; body?: MonthlyCashflow[] }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(response))
}

const month = (expenses: number): MonthlyCashflow => ({ month: '2026-04', income: 0, expenses })

function renderCard(categories: CategoryKey[] = ['FUEL', 'SAVINGS']) {
  const onViewTransactions = vi.fn()
  const onViewBalance = vi.fn()
  renderWithQuery(
    <RunwayCard
      credentials={credentials}
      accountIds={[42]}
      filters={{ date_from: DATE_YEAR_START }}
      categories={categories}
      typeFilters={{ transaction_types: ['FEES'] }}
      enabled
      onViewTransactions={onViewTransactions}
      onViewBalance={onViewBalance}
    />,
  )
  return { onViewTransactions, onViewBalance }
}

const metric = (label: string) => screen.getAllByText(label)[0].nextElementSibling

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RunwayCard', () => {
  it.each([
    { expenses: AMOUNT_XL / 3, runway: `${formatMonths(3)} months` },
    { expenses: AMOUNT_XL / 12, runway: '1 year' },
    { expenses: AMOUNT_L, runway: '1 year 3 months' },
    { expenses: 0, runway: '∞' },
  ])(
    'turns $expenses of monthly expenses into a runway of $runway',
    async ({ expenses, runway }) => {
      serveCashflow({ status: 200, body: [month(expenses)] })
      renderCard()

      expect(await screen.findAllByText(runway)).not.toHaveLength(0)
      expect(metric('Balance')).toHaveTextContent(money(AMOUNT_XL))
      expect(metric('Average expenses per month')).toHaveTextContent(money(expenses))
    },
  )

  it('asks for the expenses of the selected accounts without savings categories', async () => {
    const fetchSpy = serveCashflow({ status: 200, body: [month(AMOUNT_L)] })
    renderCard()
    await screen.findAllByText('1 year 3 months')

    const url = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/statistics/cashflow')
    expect(url.searchParams.getAll('account_ids')).toEqual(['42'])
    expect(url.searchParams.getAll('categories')).toEqual(['FUEL'])
    expect(url.searchParams.get('date_from')).toBe(DATE_YEAR_START)
    expect(url.searchParams.getAll('transaction_types')).toEqual(['FEES'])
  })

  it('drills into the balances and into the counted expenses', async () => {
    const user = userEvent.setup()
    serveCashflow({ status: 200, body: [month(AMOUNT_L)] })
    const { onViewBalance, onViewTransactions } = renderCard()
    await screen.findAllByText('1 year 3 months')

    await user.click(screen.getAllByRole('button', { name: 'Current balances' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Expenses in this period' })[0])

    expect(onViewBalance).toHaveBeenCalledTimes(1)
    expect(onViewTransactions).toHaveBeenCalledWith(['FUEL'])
  })

  it('needs no request when only savings categories are selected', () => {
    const fetchSpy = serveCashflow({ status: 200, body: [] })
    renderCard(['SAVINGS', 'INVESTMENT'])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getAllByText('∞')).not.toHaveLength(0)
    expect(metric('Average expenses per month')).toHaveTextContent(money(0))
    expect(screen.queryByRole('button', { name: 'Expenses in this period' })).toBeNull()
  })

  it('says so when the expenses cannot be loaded', async () => {
    serveCashflow({ status: 500 })
    renderCard()
    expect(await screen.findByText('Could not load.')).toBeInTheDocument()
  })

  it('says so when no expenses match the filters', async () => {
    serveCashflow({ status: 200, body: [] })
    renderCard()
    expect(await screen.findByText('No transactions match your filters.')).toBeInTheDocument()
  })
})
