import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children: React.ReactNode
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }
    if (search) {
      const qs = new URLSearchParams(
        Object.entries(search).map(([k, v]) => [k, String(v)]),
      ).toString()
      if (qs) href = `${href}?${qs}`
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

function buildTransaction(overrides: Partial<TransactionDetailRead> = {}): TransactionDetailRead {
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
    transfer_counterpart_id: null,
    transfer_counterpart: null,
    ...overrides,
  }
}

function renderView(overrides: Partial<TransactionDetailRead> = {}) {
  const onSaveNote = vi.fn().mockResolvedValue(undefined)
  const onChangeCategory = vi.fn().mockResolvedValue(undefined)
  const onUnlink = vi.fn().mockResolvedValue(undefined)
  render(
    <TransactionDetailView
      accountId={42}
      transaction={buildTransaction(overrides)}
      counterpartAccountName="Sparkonto"
      onSaveNote={onSaveNote}
      onChangeCategory={onChangeCategory}
      onUnlink={onUnlink}
    />,
  )
  return { onSaveNote, onChangeCategory, onUnlink }
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

  it('renders the date in long form following the active language', () => {
    renderView({ date: '2026-05-20' })
    const dateLabel = screen.getByText('Date')
    const dateValue = dateLabel.nextElementSibling
    expect(dateValue?.textContent).toMatch(/May 20, 2026/)
  })

  it('falls back to the em-dash placeholder when other_party / purpose are missing', () => {
    renderView({ other_party: null, purpose: '   ' })
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the translated transaction type alongside an icon', () => {
    renderView({ transaction_type: 'OUTGOING' })
    expect(screen.getByText('Outgoing')).toBeInTheDocument()
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

  it('does not render the linked-transaction field when there is no counterpart', () => {
    renderView({ transfer_counterpart: null })
    expect(screen.queryByText('Linked transaction')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument()
  })

  it('renders the linked-transaction field linking to the counterpart account with a focus param', () => {
    const counterpart: TransactionRead = {
      id: 99,
      account_id: 55,
      amount: 42.5,
      purpose: null,
      date: '2026-05-20',
      other_party: null,
      transaction_type: 'TRANSFER_IN',
      category: 'TRANSFER',
      note: null,
      transfer_counterpart_id: 7,
    }
    renderView({ transfer_counterpart_id: 99, transfer_counterpart: counterpart })
    const link = screen.getByRole('link', { name: /Sparkonto/ })
    expect(link).toHaveAttribute('href', '/account/55?focus=99')
  })

  it('calls onUnlink when the user clicks "Remove link"', async () => {
    const user = userEvent.setup()
    const counterpart: TransactionRead = {
      id: 99,
      account_id: 55,
      amount: 42.5,
      purpose: null,
      date: '2026-05-20',
      other_party: null,
      transaction_type: 'TRANSFER_IN',
      category: 'TRANSFER',
      note: null,
      transfer_counterpart_id: 7,
    }
    const { onUnlink } = renderView({
      transfer_counterpart_id: 99,
      transfer_counterpart: counterpart,
    })
    await user.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onUnlink).toHaveBeenCalledTimes(1)
  })

  it('renders the linked-transaction field above the note', () => {
    const counterpart: TransactionRead = {
      id: 99,
      account_id: 55,
      amount: 42.5,
      purpose: null,
      date: '2026-05-20',
      other_party: null,
      transaction_type: 'TRANSFER_IN',
      category: 'TRANSFER',
      note: null,
      transfer_counterpart_id: 7,
    }
    renderView({ transfer_counterpart_id: 99, transfer_counterpart: counterpart })
    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual([
      'Recipient',
      'Date',
      'Purpose',
      'Type',
      'Category',
      'Linked transaction',
      'Note',
    ])
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
