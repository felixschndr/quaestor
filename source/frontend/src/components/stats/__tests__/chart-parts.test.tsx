import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { AMOUNT_M, AMOUNT_XL, PARTY_SUPERMARKET, money } from '@/test/constants'
import { ArrowTick, AxisValueTick, BarValueLabel, ToggleTick, ValueBarShape } from '../chart-parts'

const renderSvg = (ui: ReactNode) => render(<svg>{ui}</svg>)

describe('BarValueLabel', () => {
  it('renders nothing without a value', () => {
    const { container } = renderSvg(<BarValueLabel x={0} width={200} />)
    expect(container.querySelector('text')).toBeNull()
  })

  it('right-aligns the amount inside a bar wide enough to hold it', () => {
    renderSvg(<BarValueLabel x={10} y={20} width={200} height={10} value={AMOUNT_XL} />)

    const label = screen.getByText(money(AMOUNT_XL))
    expect(label).toHaveAttribute('text-anchor', 'end')
    expect(label).toHaveAttribute('x', String(10 + 200 - 6))
    expect(label).toHaveAttribute('y', String(20 + 5))
  })

  it('places the amount after a bar too narrow to hold it', () => {
    renderSvg(<BarValueLabel x={10} width={20} value={AMOUNT_XL} />)

    const label = screen.getByText(money(AMOUNT_XL))
    expect(label).toHaveAttribute('text-anchor', 'start')
    expect(label).toHaveAttribute('x', String(10 + 20 + 6))
  })
})

describe('ValueBarShape', () => {
  it('labels a stacked bar with its upper bound', () => {
    renderSvg(<ValueBarShape x={0} y={0} width={200} height={20} value={[AMOUNT_M, AMOUNT_XL]} />)
    expect(screen.getByText(money(AMOUNT_XL))).toBeInTheDocument()
  })

  it('drops the label for rows the chart marks as hidden', () => {
    const labelHidden = vi.fn(() => true)
    const payload = { key: PARTY_SUPERMARKET }
    renderSvg(
      <ValueBarShape
        x={0}
        y={0}
        width={200}
        height={20}
        value={AMOUNT_XL}
        payload={payload}
        labelHidden={labelHidden}
      />,
    )

    expect(labelHidden).toHaveBeenCalledWith(payload)
    expect(screen.queryByText(money(AMOUNT_XL))).toBeNull()
  })
})

describe('ToggleTick', () => {
  const labelOf = (key: string) => `Label ${key}`

  it('toggles the row it labels when clicked', async () => {
    const onToggle = vi.fn()
    renderSvg(
      <ToggleTick
        payload={{ value: 'FUEL' }}
        labelOf={labelOf}
        hidden={new Set()}
        onToggle={onToggle}
      />,
    )

    await userEvent.click(screen.getByText('Label FUEL'))

    expect(onToggle).toHaveBeenCalledWith('FUEL')
  })

  it('shortens long labels with an ellipsis', () => {
    renderSvg(
      <ToggleTick
        payload={{ value: 'ABCDEFGHIJ' }}
        labelOf={(key) => key}
        hidden={new Set()}
        onToggle={vi.fn()}
        maxChars={5}
      />,
    )
    expect(screen.getByText('ABCD…')).toBeInTheDocument()
  })

  it('strikes through and mutes a hidden row', () => {
    renderSvg(
      <ToggleTick
        payload={{ value: 'FUEL' }}
        labelOf={labelOf}
        hidden={new Set(['FUEL'])}
        onToggle={vi.fn()}
      />,
    )

    const label = screen.getByText('Label FUEL')
    expect(label).toHaveStyle({ textDecoration: 'line-through' })
    expect(label).toHaveAttribute('fill', 'var(--color-muted-foreground)')
  })

  it('falls back to an empty key without a payload', async () => {
    const onToggle = vi.fn()
    renderSvg(<ToggleTick labelOf={labelOf} hidden={new Set()} onToggle={onToggle} />)

    await userEvent.click(screen.getByText('Label'))

    expect(onToggle).toHaveBeenCalledWith('')
  })
})

describe('AxisValueTick', () => {
  it('shows the formatted axis value', () => {
    const format = vi.fn((value: unknown) => `#${String(value)}`)
    renderSvg(<AxisValueTick payload={{ value: AMOUNT_M }} format={format} />)
    expect(screen.getByText(`#${AMOUNT_M}`)).toBeInTheDocument()
  })
})

describe('ArrowTick', () => {
  it('drills into the row it sits next to', async () => {
    const onSelect = vi.fn()
    renderSvg(<ArrowTick x={5} y={7} payload={{ value: PARTY_SUPERMARKET }} onSelect={onSelect} />)

    const arrow = screen.getByRole('button')
    expect(arrow).toHaveAttribute('transform', 'translate(5, 7)')
    await userEvent.click(arrow)

    expect(onSelect).toHaveBeenCalledWith(PARTY_SUPERMARKET)
  })

  it('drills with an empty key without a payload', async () => {
    const onSelect = vi.fn()
    renderSvg(<ArrowTick onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith('')
  })
})
