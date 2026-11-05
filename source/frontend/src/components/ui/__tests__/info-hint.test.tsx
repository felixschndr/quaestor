import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { InfoHint } from '@/components/ui/info-hint'
import { LABEL_SAVINGS } from '@/test/constants'

describe('InfoHint', () => {
  it('shows its text on hover and leaves no focus on the icon afterwards', async () => {
    const user = userEvent.setup()
    render(<InfoHint>{LABEL_SAVINGS}</InfoHint>)
    const trigger = screen.getByRole('button', { name: 'Info' })

    await user.hover(trigger)
    expect(await screen.findByText(LABEL_SAVINGS)).toBeInTheDocument()

    await user.unhover(trigger)
    expect(screen.queryByText(LABEL_SAVINGS)).not.toBeInTheDocument()
    expect(trigger).not.toHaveFocus()
  })
})
