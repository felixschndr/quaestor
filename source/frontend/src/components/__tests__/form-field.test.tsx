import { render, screen } from '@testing-library/react'
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

  it('renders the hint as a description below the control', () => {
    render(
      <FormField id="tol" label="Tolerance" hint="How far a match may deviate">
        <input id="tol" />
      </FormField>,
    )
    expect(screen.getByText('How far a match may deviate')).toBeInTheDocument()
  })

  it('omits the hint paragraph when no hint is given', () => {
    const { container } = render(
      <FormField id="note" label="Note">
        <input id="note" />
      </FormField>,
    )
    expect(container.querySelector('p')).toBeNull()
  })
})
