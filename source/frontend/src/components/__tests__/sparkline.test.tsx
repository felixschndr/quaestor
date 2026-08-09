import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Sparkline } from '../sparkline'

const pathOf = (values: number[]) =>
  render(<Sparkline values={values} />)
    .container.querySelector('path')
    ?.getAttribute('d')

describe('Sparkline', () => {
  it('draws a straight line between two points', () => {
    expect(pathOf([0, 100])).toBe('M0.00,38.00  L100.00,2.00')
  })

  it('rounds every direction change with a quadratic through the midpoints', () => {
    expect(pathOf([0, 100, 0])).toBe('M0.00,38.00 Q50.00,2.00 75.00,20.00 L100.00,38.00')
  })

  it('overlays the active dot ON the smoothed curve, not on the vertex', () => {
    const { container } = render(<Sparkline values={[0, 100, 0]} activeIndex={1} />)
    const dot = container.querySelector('span')
    expect(dot?.style.left).toBe('50%')
    expect(dot?.style.top).toBe('27.5%')
  })

  it('draws no marker without an active index', () => {
    const { container } = render(<Sparkline values={[0, 100, 0]} />)
    expect(container.querySelector('span')).toBeNull()
  })
})
