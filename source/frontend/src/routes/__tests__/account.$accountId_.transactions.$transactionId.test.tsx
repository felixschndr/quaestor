import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))

import {
  TransactionDetailView,
  otherPartyLabelKey,
} from '@/routes/account.$accountId_.transactions.$transactionId'

function buildTransaction(overrides: Partial<TransactionRead> = {}): TransactionRead {
  return {
    id: 7,
    account_id: 42,
    amount: -42.5,
    purpose: 'Weekly groceries',
    date: '2026-05-20',
    other_party: 'REWE',
    transaction_type: 'OUTGOING',
    category: 'SUPERMARKET',
    note: null,
    ...overrides,
  }
}

function renderView(overrides: Partial<TransactionRead> = {}) {
  const onSaveNote = vi.fn().mockResolvedValue(undefined)
  const onChangeCategory = vi.fn().mockResolvedValue(undefined)
  render(
    <TransactionDetailView
      accountId={42}
      transaction={buildTransaction(overrides)}
      onSaveNote={onSaveNote}
      onChangeCategory={onChangeCategory}
    />,
  )
  return { onSaveNote, onChangeCategory }
}

describe('TransactionDetailView', () => {
  it('renders a back link pointing at the account', () => {
    renderView()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/account/42')
  })

  it('shows a negative amount in the destructive color', () => {
    renderView({ amount: -42.5 })
    const amount = screen.getByText('-42,50 €')
    expect(amount.className).toMatch(/text-destructive/)
  })

  it('shows a positive amount in the success color', () => {
    renderView({ amount: 1500 })
    const amount = screen.getByText('1.500,00 €')
    expect(amount.className).toMatch(/text-success/)
  })

  it('renders all fields in the table in the documented order', () => {
    // amount: -42.5 (outgoing) → "Recipient" label
    renderView()
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts).toEqual(['Recipient', 'Date', 'Purpose', 'Type', 'Category', 'Note'])
  })

  it('labels the other-party row "Sender" for incoming amounts', () => {
    renderView({ amount: 100 })
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts[0]).toBe('Sender')
  })

  it('falls back to the neutral combined label when the amount is exactly zero', () => {
    renderView({ amount: 0 })
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts[0]).toBe('Other party')
  })

  it('renders the date in long German form', () => {
    renderView({ date: '2026-05-20' })
    const dateLabel = screen.getByText('Date')
    const dateValue = dateLabel.nextElementSibling
    expect(dateValue?.textContent).toMatch(/20\. Mai 2026/)
  })

  it('falls back to the em-dash placeholder when other_party / purpose are missing', () => {
    renderView({ other_party: null, purpose: '   ' })
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the raw transaction type alongside an icon', () => {
    renderView({ transaction_type: 'OUTGOING' })
    expect(screen.getByText('OUTGOING')).toBeInTheDocument()
  })

  it('renders the em-dash when transaction_type is null', () => {
    renderView({ transaction_type: null })
    const typeLabel = screen.getByText('Type')
    expect(typeLabel.nextElementSibling?.textContent).toBe('—')
  })

  it('preselects the current category in the dropdown', () => {
    renderView({ category: 'RESTAURANTS' })
    const select = screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement
    expect(select.value).toBe('RESTAURANTS')
    // The full enum should be available, plus UNKNOWN at the bottom.
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options[options.length - 1].value).toBe('UNKNOWN')
    expect(options.some((option) => option.value === 'SUPERMARKET')).toBe(true)
  })

  it('sorts categories alphabetically by their localised label, pinning UNKNOWN last', () => {
    renderView()
    const select = screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    const labels = options.map((option) => option.textContent ?? '')
    const labelsExceptLast = labels.slice(0, -1)
    const sorted = [...labelsExceptLast].sort((a, b) => a.localeCompare(b))
    expect(labelsExceptLast).toEqual(sorted)
    expect(labels[labels.length - 1]).toBe('Unknown')
  })

  it('calls onChangeCategory when the user picks a new category', async () => {
    const user = userEvent.setup()
    const { onChangeCategory } = renderView({ category: 'SUPERMARKET' })
    const select = screen.getByRole('combobox', { name: 'Category' })
    await user.selectOptions(select, 'RESTAURANTS')
    expect(onChangeCategory).toHaveBeenCalledWith('RESTAURANTS')
  })
})

describe('otherPartyLabelKey', () => {
  it('returns the recipient key for outgoing amounts', () => {
    expect(otherPartyLabelKey(-1)).toBe('transaction.recipient')
  })

  it('returns the sender key for incoming amounts', () => {
    expect(otherPartyLabelKey(1)).toBe('transaction.sender')
  })

  it('returns the neutral key for zero amounts', () => {
    expect(otherPartyLabelKey(0)).toBe('transaction.otherParty')
  })
})

describe('TransactionDetailView — note auto-save', () => {
  it('saves the note after the debounce window, sending only the final value', async () => {
    const user = userEvent.setup()
    const { onSaveNote } = renderView({ note: null })

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'hi')

    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1))
    expect(onSaveNote).toHaveBeenCalledWith('hi')
  })

  it('sends null when the user clears an existing note (per §3.4)', async () => {
    const user = userEvent.setup()
    const { onSaveNote } = renderView({ note: 'existing' })
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)

    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1))
    expect(onSaveNote).toHaveBeenCalledWith(null)
  })

  it('shows the "Saved" indicator once the save resolves', async () => {
    const user = userEvent.setup()
    renderView({ note: null })
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'x')
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
