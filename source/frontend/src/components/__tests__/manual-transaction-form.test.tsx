import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})) }))

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast }))

import { api } from '@/lib/api'
import { ManualTransactionForm } from '@/components/manual-transaction-form'
import { renderWithQuery } from '@/test/helpers'
import { selectFromPopover } from '@/test/popover-select'
import type { TransactionRead } from '@/lib/accountHistory'
import type { RecurringTransactionRead } from '@/lib/recurringTransaction'
import { todayIso } from '@/lib/format'
import {
  AMOUNT_M,
  AMOUNT_S,
  DATE_NEXT_RUN,
  DATE_OLDER,
  LABEL_RENT,
  PARTY_SUPERMARKET,
} from '@/test/constants'

const mockedApi = vi.mocked(api)

function renderForm() {
  const onDone = vi.fn()
  renderWithQuery(<ManualTransactionForm accountId={7} mode="create" onDone={onDone} />)
  return { onDone }
}

beforeEach(() => {
  mockedApi.mockResolvedValue({})
})

const booked: TransactionRead = {
  id: 5,
  account_id: 7,
  amount: -AMOUNT_S,
  purpose: null,
  date: DATE_OLDER,
  other_party: PARTY_SUPERMARKET,
  transaction_type: null,
  category: 'SUPERMARKET',
  note: null,
}

const rule: RecurringTransactionRead = {
  id: 3,
  account_id: 7,
  amount: -AMOUNT_M,
  purpose: null,
  other_party: PARTY_SUPERMARKET,
  transaction_type: null,
  category: null,
  note: null,
  frequency: 'MONTHLY',
  day_of_month: 1,
  day_of_week: null,
  next_run_date: DATE_NEXT_RUN,
}

function renderEdit(props: Partial<React.ComponentProps<typeof ManualTransactionForm>>) {
  const onDone = vi.fn()
  renderWithQuery(<ManualTransactionForm accountId={7} mode="edit" onDone={onDone} {...props} />)
  return { onDone }
}

describe('ManualTransactionForm — recurring', () => {
  it('reveals the schedule fields and hides the date when recurring is enabled', async () => {
    const user = userEvent.setup()
    renderForm()

    expect(screen.getByLabelText('Date')).toBeInTheDocument()
    expect(screen.queryByLabelText('Frequency')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))

    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Frequency')).toBeInTheDocument()
    expect(screen.getByLabelText('Day of month')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Book first transaction today' })).toBeInTheDocument()
  })

  it('posts a monthly recurring payload to the recurring endpoint', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.type(screen.getByLabelText('Amount'), '50')
    await user.click(screen.getByRole('button', { name: 'Make negative' }))
    await selectFromPopover(user, 'Day of month', '15')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledTimes(1)
    const [path, options] = mockedApi.mock.calls[0]
    expect(path).toBe('/account/7/recurring-transactions')
    expect(options).toMatchObject({
      method: 'POST',
      body: {
        amount: -50,
        frequency: 'MONTHLY',
        day_of_month: 15,
        day_of_week: null,
        book_immediately: false,
      },
    })
  })

  it('switches the day picker to a weekday and posts a weekly payload with book_immediately', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.type(screen.getByLabelText('Amount'), '1000')
    await selectFromPopover(user, 'Frequency', 'Weekly')
    expect(screen.queryByLabelText('Day of month')).not.toBeInTheDocument()
    await selectFromPopover(user, 'Weekday', 'Wednesday')
    await user.click(screen.getByRole('switch', { name: 'Book first transaction today' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledTimes(1)
    const [path, options] = mockedApi.mock.calls[0]
    expect(path).toBe('/account/7/recurring-transactions')
    expect(options).toMatchObject({
      method: 'POST',
      body: {
        amount: 1000,
        frequency: 'WEEKLY',
        day_of_month: null,
        day_of_week: 2,
        book_immediately: true,
      },
    })
  })

  it('marks the amount invalid only after a failed save attempt, not on first render', async () => {
    const user = userEvent.setup()
    renderForm()

    const amount = screen.getByLabelText('Amount')
    expect(amount).not.toHaveAttribute('aria-invalid')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('formats the amount to two decimals on blur', async () => {
    const user = userEvent.setup()
    renderForm()

    const amount = screen.getByLabelText('Amount')
    await user.type(amount, '50')
    await user.tab()

    expect(amount).toHaveValue('50,00')
  })

  it('shows day-of-month options with a leading zero', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.click(screen.getByLabelText('Day of month'))
    const list = await screen.findByRole('list', { name: 'Day of month' })
    expect(within(list).getByRole('button', { name: '05' })).toBeInTheDocument()
  })

  it('shows a hint about month-end clamping below the day-of-month field', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    expect(screen.getByText(/last day of that month/)).toBeInTheDocument()
  })

  it('edits an existing recurring rule via PATCH, pre-filled and without a date field', async () => {
    const user = userEvent.setup()
    renderEdit({ recurringTransaction: rule })

    expect(screen.getByLabelText('Amount')).toHaveValue('50,00')
    expect(screen.getByRole('button', { name: 'Make positive' })).toBeInTheDocument()
    expect(screen.getByLabelText('Frequency')).toBeInTheDocument()
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Book first transaction today' }),
    ).not.toBeInTheDocument()

    await selectFromPopover(user, 'Day of month', '05')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledTimes(1)
    const [path, options] = mockedApi.mock.calls[0]
    expect(path).toBe('/account/7/recurring-transactions/3')
    expect(options).toMatchObject({
      method: 'PATCH',
      body: { amount: -AMOUNT_M, frequency: 'MONTHLY', day_of_month: 5, day_of_week: null },
    })
  })

  it('opens the select on Enter instead of submitting the form', async () => {
    const user = userEvent.setup()
    renderForm()

    const category = screen.getByLabelText('Category')
    category.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('list', { name: 'Category' })).toBeInTheDocument()
    expect(mockedApi).not.toHaveBeenCalled()
  })
})

describe('ManualTransactionForm — one-off transactions', () => {
  it('trims the texts of a new transaction and sends blank ones as null', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm()

    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_S))
    await user.type(screen.getByLabelText('Recipient / Sender'), `  ${PARTY_SUPERMARKET}  `)
    await user.type(screen.getByLabelText('Purpose'), '   ')
    await user.type(screen.getByLabelText('Note'), ` ${LABEL_RENT} `)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledWith('/account/7/transactions', {
      method: 'POST',
      body: {
        amount: AMOUNT_S,
        date: todayIso(),
        purpose: null,
        other_party: PARTY_SUPERMARKET,
        transaction_type: null,
        category: null,
        note: LABEL_RENT,
      },
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Transaction created'))
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('saves with Enter from a text field', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Amount'), `${AMOUNT_S}{Enter}`)

    expect(mockedApi).toHaveBeenCalledWith('/account/7/transactions', expect.anything())
  })

  it('shows the save in progress and blocks both buttons meanwhile', async () => {
    const user = userEvent.setup()
    mockedApi.mockReturnValue(new Promise(() => {}))
    renderForm()

    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_S))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('button', { name: 'Saving …' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('closes without saving on cancel', async () => {
    const user = userEvent.setup()
    const { onDone } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('sends only the fields that changed when editing', async () => {
    const user = userEvent.setup()
    const { onDone } = renderEdit({ transaction: booked })

    await user.type(screen.getByLabelText('Purpose'), LABEL_RENT)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledWith('/account/7/transactions/5', {
      method: 'PATCH',
      body: { purpose: LABEL_RENT },
    })
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(toast.success).toHaveBeenCalledWith('Saved')
  })

  it('sends every edited field, clearing the other party', async () => {
    const user = userEvent.setup()
    renderEdit({ transaction: booked })

    await user.click(screen.getByRole('button', { name: 'Make positive' }))
    await user.clear(screen.getByLabelText('Recipient / Sender'))
    await user.type(screen.getByLabelText('Note'), LABEL_RENT)
    await selectFromPopover(user, 'Type', 'Incoming')
    await selectFromPopover(user, 'Category', 'Restaurants')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledWith('/account/7/transactions/5', {
      method: 'PATCH',
      body: {
        amount: AMOUNT_S,
        other_party: null,
        transaction_type: 'INCOMING',
        category: 'RESTAURANTS',
        note: LABEL_RENT,
      },
    })
  })

  it('closes an unchanged edit without a request', async () => {
    const user = userEvent.setup()
    const { onDone } = renderEdit({ transaction: booked })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(mockedApi).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Saved')
  })
})

describe('ManualTransactionForm — failures', () => {
  it.each([
    ['a new transaction', () => renderForm(), false, 'Could not create transaction.'],
    ['a new recurring rule', () => renderForm(), true, 'Could not create recurring transaction.'],
    ['an edited transaction', () => renderEdit({ transaction: booked }), false, 'Could not save.'],
    [
      'an edited recurring rule',
      () => renderEdit({ recurringTransaction: rule }),
      false,
      'Could not save recurring transaction.',
    ],
  ])('keeps the form open when saving %s fails', async (_label, open, recurring, message) => {
    const user = userEvent.setup()
    mockedApi.mockRejectedValue(new Error('boom'))
    const { onDone } = open()

    if (recurring) await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), String(AMOUNT_M))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('confirms a saved recurring rule', async () => {
    const user = userEvent.setup()
    const { onDone } = renderEdit({ recurringTransaction: rule })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recurring transaction saved'))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
