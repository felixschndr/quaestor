import { cloneElement, type ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import '@/i18n'
import { CategoryChart } from '../category-chart'
import { CashflowChart } from '../cashflow-chart'
import { OtherPartyChart } from '../other-party-chart'
import { NetSavingsChart } from '../net-savings-chart'

describe('charts render with real recharts', () => {
  it('CategoryChart bar', () => {
    expect(() =>
      render(
        <CategoryChart
          slices={[{ category: 'FUEL', total: 10 }]}
          chartType="bar"
          hidden={new Set()}
          onToggleHidden={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })
  it('CategoryChart pie', () => {
    expect(() =>
      render(
        <CategoryChart
          slices={[{ category: 'FUEL', total: 10 }]}
          chartType="pie"
          hidden={new Set()}
          onToggleHidden={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })
  it('CategoryChart pie legend reports toggles to the owner of the hidden state', async () => {
    const onToggleHidden = vi.fn()
    render(
      <CategoryChart
        slices={[{ category: 'FUEL', total: 10 }]}
        chartType="pie"
        hidden={new Set()}
        onToggleHidden={onToggleHidden}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Fuel' }))
    expect(onToggleHidden).toHaveBeenCalledWith('FUEL')
  })
  it('CategoryChart keeps hidden categories in the legend as pressed-off toggles', () => {
    render(
      <CategoryChart
        slices={[{ category: 'FUEL', total: 10 }]}
        chartType="pie"
        hidden={new Set(['FUEL'])}
        onToggleHidden={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Fuel' })).toHaveAttribute('aria-pressed', 'false')
  })
  it('CashflowChart', () => {
    expect(() =>
      render(<CashflowChart data={[{ month: '2026-01', income: 100, expenses: 50 }]} />),
    ).not.toThrow()
  })
  it('NetSavingsChart', () => {
    expect(() =>
      render(<NetSavingsChart data={[{ month: '2026-01', net: 50, savings_rate: 50 }]} />),
    ).not.toThrow()
  })
  it('OtherPartyChart', () => {
    expect(() =>
      render(
        <OtherPartyChart
          data={[{ other_party: 'Rewe', total: 20 }]}
          hidden={new Set()}
          onToggleHidden={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })
})
