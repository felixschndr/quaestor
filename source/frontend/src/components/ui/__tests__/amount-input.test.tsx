import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'

import { AmountInput } from '@/components/ui/amount-input'

describe('AmountInput — leading sign', () => {
  it('strips a leading "-" into the sign toggle instead of into the magnitude', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AmountInput id="t" value={undefined} onChange={onChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.type(input, '-5')

    expect(input.value).toBe('5')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(onChange).toHaveBeenLastCalledWith(-5)
  })

  it('strips a leading "+" and forces the sign back to positive', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AmountInput id="t" value={-8} onChange={onChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    const toggle = screen.getByRole('button')
    expect(input.value).toBe('8')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.clear(input)
    await user.type(input, '+5')

    expect(input.value).toBe('5')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})
