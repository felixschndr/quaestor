import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { api } from '@/lib/api'
import { ExpectedTransactionForm } from '@/components/expected-transaction-form'
import type { ExpectedTransactionRead } from '@/lib/expectedTransaction'
import { formatAmountForInput } from '@/lib/format'
import { renderWithQuery } from '@/test/helpers'
import { selectFromPopover } from '@/test/popover-select'
import { AMOUNT_M, AMOUNT_XL, LABEL_SALARY, PARTY_SUPERMARKET } from '@/test/constants'

const mockedApi = vi.mocked(api)
const ACCOUNT_ID = 7

function renderForm(expected?: ExpectedTransactionRead) {
  const onDone = vi.fn()
  renderWithQuery(
    <ExpectedTransactionForm accountId={ACCOUNT_ID} expected={expected} onDone={onDone} />,
  )
  return { onDone }
}

const existing: ExpectedTransactionRead = {
  id: 3,
  account_id: ACCOUNT_ID,
  amount: AMOUNT_XL,
  other_party: PARTY_SUPERMARKET,
  note: LABEL_SALARY,
  match_tolerance_percent: 5,
}

beforeEach(() => {
  mockedApi.mockResolvedValue({})
})

describe('ExpectedTransactionForm — create', () => {
  it('posts the trimmed expectation with the chosen tolerance and closes', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm()

    expect(screen.getByLabelText('Tolerance')).toHaveTextContent('Exact')
    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_M))
    await user.click(screen.getByRole('button', { name: 'Make negative' }))
    await selectFromPopover(user, 'Tolerance', '± 10 %')
    await user.type(screen.getByLabelText('Sender / recipient'), `  ${PARTY_SUPERMARKET}  `)
    await user.type(screen.getByLabelText('Note'), `  ${LABEL_SALARY}  `)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(mockedApi).toHaveBeenCalledWith(`/account/${ACCOUNT_ID}/expected-transactions`, {
      method: 'POST',
      body: {
        amount: -AMOUNT_M,
        other_party: PARTY_SUPERMARKET,
        note: LABEL_SALARY,
        match_tolerance_percent: 10,
      },
    })
    expect(toast.success).toHaveBeenCalledWith('Expected transaction created')
  })

  it('sends blank other party and note as null with an exact match', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_M))
    await user.type(screen.getByLabelText('Note'), '   ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1))
    expect(mockedApi.mock.calls[0][1]).toEqual({
      method: 'POST',
      body: { amount: AMOUNT_M, other_party: null, note: null, match_tolerance_percent: 0 },
    })
  })

  it('refuses to save without a non-zero amount and flags the field', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm()

    const amount = screen.getByLabelText('Amount')
    expect(amount).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(amount).toHaveAttribute('aria-invalid', 'true')

    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does not submit when Enter is pressed inside a field', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Amount'), `${AMOUNT_M}{Enter}`)
    await user.type(screen.getByLabelText('Note'), `${LABEL_SALARY}{Enter}`)

    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('reports a failed create and stays open', async () => {
    const user = userEvent.setup()
    mockedApi.mockRejectedValue(new Error('boom'))
    const { onDone } = renderForm()

    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_M))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not create expected transaction'),
    )
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('locks the form while saving', async () => {
    const user = userEvent.setup()
    let resolve: (value: unknown) => void = () => {}
    mockedApi.mockReturnValue(new Promise((done) => (resolve = done)))
    const { onDone } = renderForm()

    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_M))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Saving …' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    resolve({})
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('closes without saving on cancel', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(mockedApi).not.toHaveBeenCalled()
  })
})

describe('ExpectedTransactionForm — edit', () => {
  it('pre-fills the expectation and patches it', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm(existing)

    expect(screen.getByLabelText('Amount')).toHaveValue(formatAmountForInput(AMOUNT_XL))
    expect(screen.getByLabelText('Tolerance')).toHaveTextContent('± 5 %')
    expect(screen.getByLabelText('Sender / recipient')).toHaveValue(PARTY_SUPERMARKET)
    expect(screen.getByLabelText('Note')).toHaveValue(LABEL_SALARY)

    await user.clear(screen.getByLabelText('Note'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(mockedApi).toHaveBeenCalledWith(
      `/account/${ACCOUNT_ID}/expected-transactions/${existing.id}`,
      {
        method: 'PATCH',
        body: {
          amount: AMOUNT_XL,
          other_party: PARTY_SUPERMARKET,
          note: null,
          match_tolerance_percent: 5,
        },
      },
    )
    expect(toast.success).toHaveBeenCalledWith('Expected transaction updated')
  })

  it('falls back to empty fields and an exact match for a sparse expectation', () => {
    renderForm({ ...existing, other_party: null, note: null, match_tolerance_percent: null })

    expect(screen.getByLabelText('Tolerance')).toHaveTextContent('Exact')
    expect(screen.getByLabelText('Sender / recipient')).toHaveValue('')
    expect(screen.getByLabelText('Note')).toHaveValue('')
  })

  it('reports a failed update', async () => {
    const user = userEvent.setup()
    mockedApi.mockRejectedValue(new Error('boom'))
    const { onDone } = renderForm(existing)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not update expected transaction'),
    )
    expect(onDone).not.toHaveBeenCalled()
  })
})
