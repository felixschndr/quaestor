import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import '@/i18n'
import { CategoryChart } from '../category-chart'
import { CashflowChart } from '../cashflow-chart'
import { OtherPartyChart } from '../other-party-chart'
import { NetSavingsChart } from '../net-savings-chart'

// Renders the REAL recharts (no mock) with data, to catch render-time crashes.
describe('charts render with real recharts', () => {
  it('CategoryChart bar', () => {
    expect(() =>
      render(<CategoryChart slices={[{ category: 'FUEL', total: 10 }]} chartType="bar" />),
    ).not.toThrow()
  })
  it('CategoryChart pie', () => {
    expect(() =>
      render(<CategoryChart slices={[{ category: 'FUEL', total: 10 }]} chartType="pie" />),
    ).not.toThrow()
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
      render(<OtherPartyChart data={[{ other_party: 'Rewe', total: 20 }]} />),
    ).not.toThrow()
  })
})
