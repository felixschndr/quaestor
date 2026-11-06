import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

import '@/i18n'
import { formatPercent } from '@/lib/format'
import type { CategoryTrendSlice } from '@/lib/statistics'
import { AMOUNT_L, AMOUNT_M, money } from '@/test/constants'
import { fakeHref } from '@/test/statsFixtures'
import { CategoryTrendChart } from '../category-trend-chart'

const percent = (ratio: number, whole: boolean) =>
  formatPercent(ratio, whole).replace(/\u00a0/g, ' ')

const slices: CategoryTrendSlice[] = [
  { category: 'FUEL', current: AMOUNT_L * 1.2, baseline: AMOUNT_L },
  { category: 'HEALTH_INSURANCE', current: AMOUNT_L * 0.93, baseline: AMOUNT_L },
  { category: 'RENT', current: AMOUNT_L * 1.01, baseline: AMOUNT_L },
  { category: 'SUPERMARKET', current: AMOUNT_M, baseline: 0 },
  { category: 'SALARY', current: 0.004, baseline: AMOUNT_L },
]

const row = (label: string) => screen.getByText(label).closest('tr')!

describe('CategoryTrendChart', () => {
  it('flags spending above the average as unfavorable and below it as favorable', () => {
    render(<CategoryTrendChart slices={slices} direction="OUTGOING" />)

    const fuel = row('Fuel')
    expect(fuel).toHaveTextContent(`${money(AMOUNT_L * 1.2)} (${percent(0.2, true)})`)
    expect(fuel.querySelector('.lucide-arrow-up')).not.toBeNull()
    expect(fuel.querySelector('.text-destructive')).not.toBeNull()

    const insurance = row('Health insurance')
    expect(insurance).toHaveTextContent(`(${percent(0.07, false)})`)
    expect(insurance.querySelector('.lucide-arrow-down')).not.toBeNull()
    expect(insurance.querySelector('.text-success')).not.toBeNull()
  })

  it('reads a rise as favorable for income', () => {
    render(<CategoryTrendChart slices={slices} direction="INCOMING" />)

    expect(row('Fuel').querySelector('.text-success')).not.toBeNull()
    expect(row('Health insurance').querySelector('.text-destructive')).not.toBeNull()
  })

  it('shows no change badge when a category is on par with its average', () => {
    render(<CategoryTrendChart slices={slices} direction="OUTGOING" />)
    expect(row('Rent')).toHaveTextContent(
      new RegExp(`^Rent${money(AMOUNT_L)}${money(AMOUNT_L * 1.01)}$`),
    )
  })

  it('marks a category without a baseline as new', () => {
    render(<CategoryTrendChart slices={slices} direction="OUTGOING" />)
    expect(row('Supermarket')).toHaveTextContent(`${money(AMOUNT_M)} (new)`)
  })

  it('leaves out categories that are zero in the current range', () => {
    render(<CategoryTrendChart slices={slices} direction="OUTGOING" />)
    expect(screen.queryByText('Salary')).toBeNull()
  })

  it('links the current range by name and the baseline by its average', async () => {
    const user = userEvent.setup()
    const currentHref = fakeHref('current')('FUEL')
    const baselineHref = fakeHref('baseline')('FUEL')
    render(
      <CategoryTrendChart
        slices={slices}
        direction="OUTGOING"
        drillHref={fakeHref('current')}
        baselineHref={fakeHref('baseline')}
      />,
    )
    const [name, average] = within(row('Fuel')).getAllByRole('link')
    expect(name).toHaveAttribute('href', currentHref)
    expect(average).toHaveAttribute('href', baselineHref)

    await user.click(name)
    await user.click(average)
    await user.click(row('Fuel').lastElementChild!) // anywhere else on the row

    expect(navigate.mock.calls).toEqual([
      [{ href: currentHref }],
      [{ href: baselineHref }],
      [{ href: currentHref }],
    ])
  })

  it('renders names and averages as plain text when nothing can be drilled', () => {
    render(<CategoryTrendChart slices={slices} direction="OUTGOING" />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(row('Fuel')).not.toHaveClass('cursor-pointer')
  })
})
