import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

import '@/i18n'
import type { ContractRead } from '@/lib/contract'
import { formatDate, formatDateWithoutYear } from '@/lib/format'
import { ContractCostOverview } from '@/components/contract-cost-overview'
import {
  AMOUNT_L,
  AMOUNT_S,
  CONTRACT_NAME,
  CONTRACT_NAME_GYM,
  DATE_MID_MONTH,
  DATE_NEXT_RUN,
  DATE_OLDER,
  LABEL_SALARY,
  money,
} from '@/test/constants'

function buildContract(overrides: Partial<ContractRead> = {}): ContractRead {
  return {
    id: 1,
    account_id: 42,
    name: CONTRACT_NAME,
    note: null,
    category: 'STREAMING',
    source: 'DETECTED',
    median_amount: -AMOUNT_S,
    frequency: 'MONTHLY',
    expected_next_date: DATE_NEXT_RUN,
    end_date: null,
    is_archived: false,
    is_overdue: false,
    amount_per_day: -1,
    amount_per_frequency: {
      WEEKLY: -2,
      BIWEEKLY: -4,
      MONTHLY: -AMOUNT_S,
      QUARTERLY: -3 * AMOUNT_S,
      YEARLY: -12 * AMOUNT_S,
    },
    ...overrides,
  }
}

const streaming = buildContract()
const salary = buildContract({
  id: 2,
  name: LABEL_SALARY,
  category: null,
  median_amount: AMOUNT_L,
  amount_per_day: 3,
  amount_per_frequency: {
    WEEKLY: 20,
    BIWEEKLY: 40,
    MONTHLY: AMOUNT_L,
    QUARTERLY: 3 * AMOUNT_L,
    YEARLY: 12 * AMOUNT_L,
  },
})
const irregular = buildContract({
  id: 3,
  name: CONTRACT_NAME_GYM,
  frequency: null,
  is_overdue: true,
  expected_next_date: DATE_MID_MONTH,
  amount_per_day: null,
  amount_per_frequency: null,
})
const unscheduled = buildContract({ id: 5, expected_next_date: null })

const desktopTable = () => screen.getAllByRole('table')[0]
const mobileList = () => screen.getByRole('list')

beforeEach(() => {
  navigate.mockClear()
})

describe('ContractCostOverview — table', () => {
  it('lists every contract per period with a total row', () => {
    render(<ContractCostOverview contracts={[streaming, salary, irregular]} />)

    const table = desktopTable()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Name', 'Day', 'Week', 'Month', 'Year'])
    const [, streamingRow, salaryRow, irregularRow, totalRow] = within(table).getAllByRole('row')
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .slice(1)
        .map((cell) => cell.textContent?.replace(/\s/g, ' '))

    expect(cells(streamingRow)).toEqual([money(-1), money(-2), money(-AMOUNT_S), money(-120)])
    expect(cells(salaryRow)).toEqual([money(3), money(20), money(AMOUNT_L), money(1200)])
    expect(cells(irregularRow)).toEqual(['—', '—', '—', '—'])
    expect(within(totalRow).getAllByRole('cell')[0]).toHaveTextContent('Total')
    expect(cells(totalRow)).toEqual([money(2), money(18), money(AMOUNT_L - AMOUNT_S), money(1080)])
  })

  it('colours the monthly column by sign and emphasises the billing period', () => {
    render(<ContractCostOverview contracts={[streaming, salary]} />)

    const [, streamingRow, salaryRow, totalRow] = within(desktopTable()).getAllByRole('row')
    const monthCell = (row: HTMLElement) => within(row).getAllByRole('cell')[3]
    expect(monthCell(streamingRow)).toHaveClass('text-destructive', 'font-medium')
    expect(monthCell(salaryRow)).toHaveClass('text-success')
    expect(monthCell(totalRow)).toHaveClass('text-success')
    expect(within(streamingRow).getAllByRole('cell')[4]).not.toHaveClass('text-destructive')
    expect(within(streamingRow).getAllByRole('cell')[4]).not.toHaveClass('font-medium')
  })

  it('shows frequency, next payment and an overdue badge per contract', () => {
    render(<ContractCostOverview contracts={[streaming, irregular, unscheduled]} />)

    const [, streamingRow, irregularRow, unscheduledRow] =
      within(desktopTable()).getAllByRole('row')
    expect(streamingRow).toHaveTextContent('Monthly')
    expect(within(streamingRow).getByText(formatDate(DATE_NEXT_RUN))).toBeInTheDocument()
    expect(within(streamingRow).queryByText('Overdue')).not.toBeInTheDocument()
    expect(irregularRow).toHaveTextContent('Irregular')
    expect(within(irregularRow).getByText('Overdue')).toBeInTheDocument()
    expect(within(irregularRow).getByText(formatDate(DATE_MID_MONTH)).parentElement).toHaveClass(
      'text-warning',
    )
    expect(within(unscheduledRow).getByRole('link')).toHaveTextContent(`${CONTRACT_NAME}Monthly`)
  })

  it('shows the archive date for archived contracts instead of the next payment', () => {
    const archived = buildContract({ is_archived: true, end_date: DATE_OLDER })
    const archivedWithoutEnd = buildContract({ id: 4, is_archived: true, name: CONTRACT_NAME_GYM })
    render(<ContractCostOverview contracts={[archived, archivedWithoutEnd]} />)

    const [, archivedRow, withoutEndRow] = within(desktopTable()).getAllByRole('row')
    expect(within(archivedRow).getByText('Archived')).toBeInTheDocument()
    expect(archivedRow).toHaveTextContent(`Archived on: ${formatDateWithoutYear(DATE_OLDER)}`)
    expect(archivedRow).not.toHaveTextContent(formatDate(DATE_NEXT_RUN))
    expect(withoutEndRow).not.toHaveTextContent('Archived on')
    expect(withoutEndRow).not.toHaveTextContent(formatDate(DATE_NEXT_RUN))
  })

  it('opens a contract from anywhere in its row', async () => {
    const user = userEvent.setup()
    render(<ContractCostOverview contracts={[streaming, salary]} />)

    const [, , salaryRow] = within(desktopTable()).getAllByRole('row')
    await user.click(within(salaryRow).getAllByRole('cell')[2])

    expect(navigate).toHaveBeenCalledWith({
      to: '/contracts/$contractId',
      params: { contractId: '2' },
    })
    expect(within(salaryRow).getByRole('link')).toHaveAttribute('href', '/contracts/2')
  })

  it('lets the name link handle the click on its own', async () => {
    const user = userEvent.setup()
    render(<ContractCostOverview contracts={[streaming]} />)

    await user.click(within(desktopTable()).getByRole('link'))

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('ContractCostOverview — mobile list', () => {
  it('shows the monthly balance and amounts by default', () => {
    render(<ContractCostOverview contracts={[streaming, salary, irregular, unscheduled]} />)

    expect(screen.getByText('Surplus').nextSibling).toHaveTextContent(
      money(AMOUNT_L - 2 * AMOUNT_S),
    )
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true')

    const [streamingItem, salaryItem, irregularItem, unscheduledItem] =
      within(mobileList()).getAllByRole('listitem')
    expect(within(streamingItem).getByRole('link')).toHaveAttribute('href', '/contracts/1')
    expect(streamingItem).toHaveTextContent('Frequency: Monthly')
    expect(streamingItem).toHaveTextContent(`Next payment: ${formatDateWithoutYear(DATE_NEXT_RUN)}`)
    expect(within(streamingItem).getByText(money(-AMOUNT_S))).toHaveClass('text-destructive')
    expect(within(salaryItem).getByText(money(AMOUNT_L))).toHaveClass('text-success')
    expect(irregularItem).toHaveTextContent('Frequency: Irregular')
    expect(within(irregularItem).getByText('—')).toBeInTheDocument()
    expect(within(irregularItem).getByText(/^Next payment/)).toHaveClass('text-warning')
    expect(within(streamingItem).getByText(/^Next payment/)).not.toHaveClass('text-warning')
    expect(unscheduledItem).not.toHaveTextContent('Next payment')
  })

  it('recomputes balance and amounts for the chosen period', async () => {
    const user = userEvent.setup()
    render(<ContractCostOverview contracts={[streaming]} />)

    await user.click(screen.getByRole('button', { name: 'Year' }))

    expect(screen.getByRole('button', { name: 'Year' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Deficit').nextSibling).toHaveTextContent(money(-120))
    expect(screen.getByText('Deficit').nextSibling).toHaveClass('text-destructive')
    expect(within(mobileList()).getByText(money(-120))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Day' }))
    expect(within(mobileList()).getByText(money(-1))).toBeInTheDocument()
  })

  it('shows archived contracts with their archive date', () => {
    const archived = buildContract({ is_archived: true, end_date: DATE_OLDER })
    const archivedWithoutEnd = buildContract({ id: 4, is_archived: true, name: CONTRACT_NAME_GYM })
    render(<ContractCostOverview contracts={[archived, archivedWithoutEnd]} />)

    const [archivedItem, withoutEndItem] = within(mobileList()).getAllByRole('listitem')
    expect(archivedItem).toHaveTextContent(`Archived on: ${formatDateWithoutYear(DATE_OLDER)}`)
    expect(archivedItem).not.toHaveTextContent('Next payment')
    expect(within(archivedItem).getByText('Archived')).toBeInTheDocument()
    expect(withoutEndItem).not.toHaveTextContent('Archived on')
    expect(withoutEndItem).not.toHaveTextContent('Next payment')
  })

  it('switches the mobile view to the table and back', async () => {
    const user = userEvent.setup()
    render(<ContractCostOverview contracts={[streaming]} />)

    expect(screen.getAllByRole('table')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Table' }))

    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Period' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(mobileList()).toBeInTheDocument()
  })
})
