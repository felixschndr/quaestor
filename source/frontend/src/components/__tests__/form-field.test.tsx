import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { FormField } from '@/components/form-field'

describe('FormField', () => {
  it('associates the label with the control via htmlFor/id', () => {
    render(
      <FormField id="amount" label="Amount">
        <input id="amount" />
      </FormField>,
    )
    expect(screen.getByLabelText('Amount')).toBe(document.getElementById('amount'))
  })

  it('shows the hint behind an info icon next to the label', async () => {
    const user = userEvent.setup()
    render(
      <FormField id="tol" label="Tolerance" hint="How far a match may deviate">
        <input id="tol" />
      </FormField>,
    )
    expect(screen.queryByText('How far a match may deviate')).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: 'Info' }))

    expect(await screen.findByText('How far a match may deviate')).toBeInTheDocument()
  })

  it('omits the info icon when no hint is given', () => {
    render(
      <FormField id="note" label="Note">
        <input id="note" />
      </FormField>,
    )
    expect(screen.queryByRole('button', { name: 'Info' })).not.toBeInTheDocument()
  })
})
