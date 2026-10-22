import { cloneElement, type ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>
    }) => cloneElement(children, { width: 400, height: 208 }),
  }
})

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

import '@/i18n'
import type { ContractMemberRead } from '@/lib/contract'
import { ContractTimeline } from '@/components/contract-timeline'
import {
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  DATE_NEXT_RUN,
  DATE_OLDER,
  DATE_PREVIOUS_YEAR,
  DATE_RECENT,
  PARTY_SUPERMARKET,
  money,
} from '@/test/constants'

function buildMember(overrides: Partial<ContractMemberRead> = {}): ContractMemberRead {
  return {
    id: 100,
    account_id: 42,
    amount: -AMOUNT_M,
    purpose: null,
    date: DATE_RECENT,
    other_party: PARTY_SUPERMARKET,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    contract_assignment: 'AUTO',
    is_outlier: false,
    ...overrides,
  }
}

function payments(count: number, amount: number): ContractMemberRead[] {
  return Array.from({ length: count }, (_, index) =>
    buildMember({ id: index + 1, amount, date: DATE_RECENT }),
  )
}

const bars = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGPathElement>('path.recharts-rectangle'))
const amountLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGTextElement>('.recharts-label-list text'))
const tickLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value')).map(
    (tick) => tick.textContent,
  )

beforeEach(() => {
  navigate.mockClear()
})

describe('ContractTimeline', () => {
  it('plots the counted payments oldest first, skipping excluded ones', () => {
    const { container } = render(
      <ContractTimeline
        members={[
          buildMember({ id: 1, date: DATE_RECENT, amount: -AMOUNT_M }),
          buildMember({ id: 2, date: DATE_RECENT, contract_assignment: 'EXCLUDED' }),
          buildMember({ id: 3, date: DATE_OLDER, amount: -AMOUNT_S }),
        ]}
        median={null}
        expectedNextDate={null}
      />,
    )

    expect(screen.getByLabelText('Payment history')).toBeInTheDocument()
    expect(bars(container)).toHaveLength(2)
    expect(amountLabels(container).map((label) => label.textContent?.replace(/\s/g, ' '))).toEqual([
      money(AMOUNT_S),
      money(AMOUNT_M),
    ])
    expect(tickLabels(container)).toEqual(['May', 'May'])
    expect(container.querySelector('.recharts-reference-line')).toBeNull()
  })

  it('labels the median line and colours outliers as warnings', () => {
    const { container } = render(
      <ContractTimeline
        members={[
          buildMember({ id: 1, amount: -AMOUNT_L, is_outlier: true }),
          buildMember({ id: 2, date: DATE_OLDER }),
        ]}
        median={-AMOUNT_M}
        expectedNextDate={null}
      />,
    )

    expect(container.querySelector('.recharts-reference-line text')).toHaveTextContent(
      money(-AMOUNT_M),
    )
    expect(bars(container).map((bar) => bar.getAttribute('fill'))).toEqual([
      'var(--color-success)',
      'var(--color-warning)',
    ])
    expect(amountLabels(container).map((label) => label.getAttribute('fill'))).toEqual([
      'var(--color-foreground)',
      'var(--color-warning)',
    ])
  })

  it('adds a dashed "expected" bar for the next payment instead of a median label', () => {
    const { container } = render(
      <ContractTimeline
        members={[buildMember({ id: 1 }), buildMember({ id: 2, date: DATE_OLDER })]}
        median={-AMOUNT_M}
        expectedNextDate={DATE_NEXT_RUN}
      />,
    )

    expect(tickLabels(container)).toEqual(['May', 'May', 'Expected'])
    const ghost = bars(container)[2]
    expect(ghost).toHaveAttribute('fill', 'transparent')
    expect(ghost).toHaveAttribute('stroke-dasharray', '3 2')
    expect(amountLabels(container)[2]).toHaveAttribute('fill', 'var(--color-primary)')
    expect(container.querySelector('.recharts-reference-line line')).not.toBeNull()
    expect(container.querySelector('.recharts-reference-line text')).toBeNull()
  })

  it('opens the transaction behind a bar, but not for the expected bar', () => {
    const { container } = render(
      <ContractTimeline
        members={[buildMember({ id: 11 }), buildMember({ id: 12, date: DATE_OLDER })]}
        median={-AMOUNT_M}
        expectedNextDate={DATE_NEXT_RUN}
      />,
    )

    const [older, , ghost] = bars(container)
    fireEvent.click(ghost)
    expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(older)
    expect(navigate).toHaveBeenCalledWith({
      to: '/transactions/$transactionId',
      params: { transactionId: '12' },
    })
  })

  it('marks the years below the axis when the payments span a year change', () => {
    const { container } = render(
      <ContractTimeline
        members={[buildMember({ id: 1 }), buildMember({ id: 2, date: DATE_PREVIOUS_YEAR })]}
        median={null}
        expectedNextDate={null}
      />,
    )

    expect(tickLabels(container)).toEqual(['Dec', 'May'])
    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.getByText('2026')).toBeInTheDocument()
  })

  it('shows no year marks within a single year', () => {
    render(
      <ContractTimeline
        members={[buildMember({ id: 1 }), buildMember({ id: 2, date: DATE_OLDER })]}
        median={null}
        expectedNextDate={null}
      />,
    )

    expect(screen.queryByText('2026')).not.toBeInTheDocument()
  })

  it('keeps amount labels horizontal while they fit the bar', () => {
    const { container } = render(
      <ContractTimeline members={payments(2, -AMOUNT_XL)} median={null} expectedNextDate={null} />,
    )

    for (const label of amountLabels(container)) {
      expect(label).toHaveAttribute('text-anchor', 'middle')
      expect(label).not.toHaveAttribute('transform')
    }
  })

  it('tilts amount labels that are wider than their bar', () => {
    const { container } = render(
      <ContractTimeline members={payments(8, -AMOUNT_XL)} median={null} expectedNextDate={null} />,
    )

    const [label] = amountLabels(container)
    expect(label).toHaveAttribute('text-anchor', 'start')
    const angle = Number(label.getAttribute('transform')?.match(/rotate\((-?[\d.]+)/)?.[1])
    expect(angle).toBeLessThan(0)
    expect(angle).toBeGreaterThanOrEqual(-60)
  })

  it('stands amount labels upright when bars are very narrow', () => {
    const { container } = render(
      <ContractTimeline members={payments(14, -AMOUNT_XL)} median={null} expectedNextDate={null} />,
    )

    for (const label of amountLabels(container)) {
      expect(label.getAttribute('transform')).toMatch(/^rotate\(-90 /)
    }
  })

  it('draws an empty chart when there is nothing to plot', () => {
    const { container } = render(
      <ContractTimeline members={[]} median={null} expectedNextDate={DATE_NEXT_RUN} />,
    )

    expect(screen.getByLabelText('Payment history')).toBeInTheDocument()
    expect(bars(container)).toHaveLength(0)
  })
})
