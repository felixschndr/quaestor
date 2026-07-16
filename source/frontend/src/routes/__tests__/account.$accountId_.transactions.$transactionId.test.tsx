import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { selectFromPopover } from '@/test/popover-select'
import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import {
  TransactionDetailView,
  otherPartyLabelKey,
  transferPartnerLabel,
} from '@/pages/account.$accountId_.transactions.$transactionId'

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
    transfer_counterpart: null,
    ...overrides,
  }
}

function renderView(
  overrides: Partial<TransactionDetailRead> = {},
  extraProps: Partial<React.ComponentProps<typeof TransactionDetailView>> = {},
) {
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
      {...extraProps}
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
    expect(dts).toEqual(['Recipient', 'Purpose', 'Category', 'Account', 'Note'])
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

  it('renders the date in long form in the header following the active language', () => {
    renderView({ date: '2026-05-20' })
    expect(screen.getByText(/May 20, 2026/)).toBeInTheDocument()
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

  it('omits the type segment in the header when transaction_type is null', () => {
    renderView({ transaction_type: null })
    // The type is shown next to the date in the header; with no type we drop the
    // segment entirely rather than rendering a placeholder, but the date remains.
    expect(screen.queryByText('Outgoing')).not.toBeInTheDocument()
    expect(screen.getByText(/May 20, 2026/)).toBeInTheDocument()
  })

  it('preselects the current category in the dropdown', async () => {
    const user = userEvent.setup()
    renderView({ category: 'RESTAURANTS' })
    const trigger = screen.getByLabelText('Category')
    expect(trigger).toHaveTextContent('Restaurants')
    // The full enum should be available, plus UNKNOWN at the bottom.
    await user.click(trigger)
    const list = await screen.findByRole('list', { name: 'Category' })
    const labels = within(list)
      .getAllByRole('button')
      .map((option) => option.textContent ?? '')
    expect(labels[labels.length - 1]).toBe('Unknown')
    expect(labels).toContain('Supermarket')
  })

  it('sorts categories alphabetically by their localised label, pinning UNKNOWN last', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Category'))
    const list = await screen.findByRole('list', { name: 'Category' })
    const labels = within(list)
      .getAllByRole('button')
      .map((option) => option.textContent ?? '')
    const labelsExceptLast = labels.slice(0, -1)
    const sorted = [...labelsExceptLast].sort((a, b) => a.localeCompare(b))
    expect(labelsExceptLast).toEqual(sorted)
    expect(labels[labels.length - 1]).toBe('Unknown')
  })

  it('calls onChangeCategory when the user picks a new category', async () => {
    const user = userEvent.setup()
    const { onChangeCategory } = renderView({ category: 'SUPERMARKET' })
    await selectFromPopover(user, 'Category', 'Restaurants')
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
    }
    renderView({ transfer_counterpart: counterpart })
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
    }
    const { onUnlink } = renderView({
      transfer_counterpart: counterpart,
    })
    await user.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onUnlink).toHaveBeenCalledTimes(1)
  })

  it('labels the linked transaction with the counterpart other party when present', () => {
    const counterpart: TransactionRead = {
      id: 99,
      account_id: 55,
      amount: 42.5,
      purpose: null,
      date: '2026-05-20',
      other_party: 'ACME Corp',
      transaction_type: 'TRANSFER_IN',
      category: 'TRANSFER',
      note: null,
    }
    renderView({ transfer_counterpart: counterpart })
    expect(screen.getByRole('link', { name: /ACME Corp/ })).toBeInTheDocument()
    expect(screen.queryByText(/Sparkonto/)).toBeNull()
  })

  it('renders the linkSection slot when there is no counterpart', () => {
    renderView({ transfer_counterpart: null }, { linkSection: <div>start-link-slot</div> })
    expect(screen.getByText('start-link-slot')).toBeInTheDocument()
  })

  it('does not render the linkSection when a counterpart exists', () => {
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
    }
    renderView({ transfer_counterpart: counterpart }, { linkSection: <div>start-link-slot</div> })
    expect(screen.queryByText('start-link-slot')).not.toBeInTheDocument()
    expect(screen.getByText('Linked transaction')).toBeInTheDocument()
  })

  it('renders the linkConfirmSection slot', () => {
    renderView({}, { linkConfirmSection: <div>confirm-link-slot</div> })
    expect(screen.getByText('confirm-link-slot')).toBeInTheDocument()
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
    }
    renderView({ transfer_counterpart: counterpart })
    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual([
      'Recipient',
      'Purpose',
      'Category',
      'Linked transaction',
      'Account',
      'Note',
    ])
  })
})

describe('transferPartnerLabel', () => {
  it('prefers the other party over the account name', () => {
    expect(transferPartnerLabel('ACME Corp', 'Sparkonto')).toBe('ACME Corp')
  })

  it('falls back to the account name when the other party is missing or blank', () => {
    expect(transferPartnerLabel(null, 'Sparkonto')).toBe('Sparkonto')
    expect(transferPartnerLabel('   ', 'Sparkonto')).toBe('Sparkonto')
  })

  it('formats IBAN values', () => {
    expect(transferPartnerLabel('DE89370400440532013000', null)).toBe('DE89 3704 0044 0532 0130 00')
    expect(transferPartnerLabel(null, 'DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
  })

  it('returns null when neither is available', () => {
    expect(transferPartnerLabel(null, undefined)).toBeNull()
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

    // An empty note renders a click-to-edit placeholder; enter edit mode first.
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'hi')

    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1))
    expect(onSaveNote).toHaveBeenCalledWith('hi')
  })

  it('sends null when the user clears an existing note (per §3.4)', async () => {
    const user = userEvent.setup()
    const { onSaveNote } = renderView({ note: 'existing' })
    // An existing note renders read-only first; click it to enter edit mode.
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)

    await waitFor(() => expect(onSaveNote).toHaveBeenCalledTimes(1))
    expect(onSaveNote).toHaveBeenCalledWith(null)
  })

  it('renders a URL inside a note as a clickable link', () => {
    renderView({ note: 'see https://example.com/x for details' })
    const link = screen.getByRole('link', { name: 'https://example.com/x' })
    expect(link).toHaveAttribute('href', 'https://example.com/x')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('linkifies a bare domain without scheme or www prefix', () => {
    renderView({ note: 'visit example.com/path.' })
    const link = screen.getByRole('link', { name: 'example.com/path' })
    expect(link).toHaveAttribute('href', 'https://example.com/path')
  })

  it('linkifies a www-prefixed domain without scheme', () => {
    renderView({ note: 'visit www.example.com/path for more' })
    const link = screen.getByRole('link', { name: 'www.example.com/path' })
    expect(link).toHaveAttribute('href', 'https://www.example.com/path')
  })

  it('shows the "Saved" indicator once the save resolves', async () => {
    const user = userEvent.setup()
    renderView({ note: null })
    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'x')
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
