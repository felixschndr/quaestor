import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})) }))

import { api } from '@/lib/api'
import { ManualTransactionForm } from '@/components/manual-transaction-form'
import { selectFromPopover } from '@/test/popover-select'
import type { RecurringTransactionRead } from '@/lib/recurringTransaction'

const mockedApi = vi.mocked(api)

function withClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

function renderForm() {
  const onDone = vi.fn()
  render(withClient(<ManualTransactionForm accountId={7} mode="create" onDone={onDone} />))
  return { onDone }
}

beforeEach(() => {
  mockedApi.mockClear()
  mockedApi.mockResolvedValue({})
})

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

  it('offers an info hint about month-end clamping next to the day-of-month field', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    expect(screen.getByRole('button', { name: /last day of that month/ })).toBeInTheDocument()
  })

  it('edits an existing recurring rule via PATCH, pre-filled and without a date field', async () => {
    const user = userEvent.setup()
    const rule: RecurringTransactionRead = {
      id: 3,
      account_id: 7,
      amount: -50,
      purpose: null,
      other_party: 'Landlord',
      transaction_type: null,
      category: null,
      note: null,
      frequency: 'MONTHLY',
      day_of_month: 1,
      day_of_week: null,
      next_run_date: '2026-07-01',
    }
    render(
      withClient(
        <ManualTransactionForm
          accountId={7}
          mode="edit"
          recurringTransaction={rule}
          onDone={vi.fn()}
        />,
      ),
    )

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
      body: { amount: -50, frequency: 'MONTHLY', day_of_month: 5, day_of_week: null },
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

  it('still posts a one-off transaction to the transactions endpoint when not recurring', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Amount'), '-12.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockedApi).toHaveBeenCalledTimes(1)
    const [path, options] = mockedApi.mock.calls[0]
    expect(path).toBe('/account/7/transactions')
    expect(options).toMatchObject({ method: 'POST' })
  })
})
