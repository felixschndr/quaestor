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
} from '@/pages/transactions.$transactionId'
import { compareFlowMembers, type FlowMemberView } from '@/routes/transactions.$transactionId'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_XL,
  DATE_BROKER_SETTLE,
  DATE_RECENT,
  DATE_SAME_DAY_TRANSFER,
  PARTY_SUPERMARKET,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  money,
} from '@/test/constants'

function buildTransaction(overrides: Partial<TransactionDetailRead> = {}): TransactionDetailRead {
  return {
    id: 7,
    account_id: 42,
    amount: -AMOUNT_M,
    purpose: 'Weekly groceries',
    date: DATE_RECENT,
    other_party: PARTY_SUPERMARKET,
    transaction_type: 'OUTGOING',
    category: 'SUPERMARKET',
    note: null,
    flow_members: [],
    ...overrides,
  }
}

function flowMemberOf(
  transaction: TransactionRead,
  accountName: string | null = ACCOUNT_NAME_SAVINGS,
  isCurrent = false,
) {
  return {
    transaction,
    accountName,
    bankName: null,
    bankIcon: null,
    isMarketValued: false,
    isCurrent,
  }
}

function renderView(
  overrides: Partial<TransactionDetailRead> = {},
  extraProps: Partial<React.ComponentProps<typeof TransactionDetailView>> = {},
) {
  const onSaveNote = vi.fn().mockResolvedValue(undefined)
  const onChangeCategory = vi.fn().mockResolvedValue(undefined)
  const onUnlink = vi.fn().mockResolvedValue(undefined)
  const transaction = buildTransaction(overrides)
  const flowMembers =
    transaction.flow_members.length > 0
      ? [
          flowMemberOf(transaction, ACCOUNT_NAME_GIRO, true),
          ...transaction.flow_members.map((m) => flowMemberOf(m)),
        ]
      : []
  render(
    <TransactionDetailView
      accountId={42}
      transaction={transaction}
      flowMembers={flowMembers}
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
    renderView({ amount: -AMOUNT_M })
    const amount = screen.getByText(money(-AMOUNT_M))
    expect(amount.className).toMatch(/text-destructive/)
  })

  it('shows a positive amount in the success color', () => {
    renderView({ amount: AMOUNT_XL })
    const amount = screen.getByText(money(AMOUNT_XL))
    expect(amount.className).toMatch(/text-success/)
  })

  it('renders all fields in the table in the documented order', () => {
    // amount: -AMOUNT_M (outgoing) → "Recipient" label
    renderView()
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts).toEqual(['Recipient', 'PurposePurpose', 'Category', 'Account', 'Note'])
  })

  it('labels the other-party row "Sender" for incoming amounts', () => {
    renderView({ amount: AMOUNT_L })
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts[0]).toBe('Sender')
  })

  it('falls back to the neutral combined label when the amount is exactly zero', () => {
    renderView({ amount: 0 })
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts[0]).toBe('Other party')
  })

  it('renders the date in long form in the header following the active language', () => {
    renderView({ date: DATE_RECENT })
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

  const memberTransaction: TransactionRead = {
    id: 99,
    account_id: 55,
    amount: AMOUNT_M,
    purpose: null,
    date: DATE_RECENT,
    other_party: null,
    transaction_type: 'TRANSFER_IN',
    category: 'TRANSFER',
    note: null,
  }

  it('does not render the money-flow field when the flow is empty', () => {
    renderView({ flow_members: [] })
    expect(screen.queryByText('Money flow')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from money flow' })).not.toBeInTheDocument()
  })

  it('renders each flow member linking to its transaction detail page', () => {
    renderView({ flow_members: [memberTransaction] })
    const link = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })
    expect(link).toHaveAttribute('href', '/transactions/99')
  })

  it('offers an unlink control next to every flow member', () => {
    renderView({ flow_members: [memberTransaction] })
    expect(screen.getAllByRole('button', { name: 'Remove from money flow' })).toHaveLength(2)
  })

  it('asks for confirmation and removes the addressed member from the flow', async () => {
    const user = userEvent.setup()
    const { onUnlink } = renderView({ flow_members: [memberTransaction] })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Remove from money flow' }))
    expect(onUnlink).not.toHaveBeenCalled()
    await user.click(within(row).getByRole('button', { name: 'Remove from money flow' }))
    expect(onUnlink).toHaveBeenCalledWith(memberTransaction)
  })

  it('does not remove when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const { onUnlink } = renderView({ flow_members: [memberTransaction] })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Remove from money flow' }))
    await user.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(onUnlink).not.toHaveBeenCalled()
  })

  it('hides the remove control while a link flow is in progress', () => {
    renderView({ flow_members: [memberTransaction] }, { linking: true })
    expect(screen.queryByRole('button', { name: 'Remove from money flow' })).toBeNull()
    expect(screen.getByText('Money flow')).toBeInTheDocument()
  })

  it('labels a flow member with its account name and shows the other party / purpose below', () => {
    renderView({
      flow_members: [{ ...memberTransaction, other_party: 'ACME Corp', purpose: 'Invoice 42' }],
    })
    expect(screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })).toBeInTheDocument()
    expect(screen.getByText('ACME Corp · Invoice 42')).toBeInTheDocument()
  })

  it('omits the details line when a member has no other party or purpose', () => {
    renderView({ flow_members: [{ ...memberTransaction, other_party: null, purpose: null }] })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    expect(within(row).queryByText(/·/)).toBeNull()
  })

  it('renders all flow members when there are more than one', () => {
    const second: TransactionRead = { ...memberTransaction, id: 100, account_id: 56 }
    renderView({ flow_members: [memberTransaction, second] })
    const links = screen.getAllByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/transactions/99',
      '/transactions/100',
    ])
  })

  it('shows the current transaction in the flow highlighted and without a link', () => {
    const current: TransactionRead = { ...memberTransaction, id: 7, account_id: 42 }
    renderView(
      { flow_members: [memberTransaction] },
      {
        flowMembers: [
          flowMemberOf(current, ACCOUNT_NAME_GIRO, true),
          flowMemberOf(memberTransaction),
        ],
      },
    )
    expect(screen.queryByRole('link', { name: new RegExp(ACCOUNT_NAME_GIRO) })).toBeNull()
    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })).toBeInTheDocument()
  })

  it('renders the linkSection slot when the flow is empty', () => {
    renderView({ flow_members: [] }, { linkSection: <div>start-link-slot</div> })
    expect(screen.getByText('start-link-slot')).toBeInTheDocument()
  })

  it('still renders the linkSection alongside an existing flow (so more can be added)', () => {
    renderView({ flow_members: [memberTransaction] }, { linkSection: <div>start-link-slot</div> })
    expect(screen.getByText('start-link-slot')).toBeInTheDocument()
    expect(screen.getByText('Money flow')).toBeInTheDocument()
  })

  it('renders the linkConfirmSection slot', () => {
    renderView({}, { linkConfirmSection: <div>confirm-link-slot</div> })
    expect(screen.getByText('confirm-link-slot')).toBeInTheDocument()
  })

  it('renders the money-flow field above the note', () => {
    renderView({ flow_members: [memberTransaction] })
    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual([
      'Recipient',
      'PurposePurpose',
      'Category',
      'Money flow',
      'Account',
      'Note',
    ])
  })
})

describe('transferPartnerLabel', () => {
  it('prefers the other party over the account name', () => {
    expect(transferPartnerLabel('ACME Corp', ACCOUNT_NAME_SAVINGS)).toBe('ACME Corp')
  })

  it('falls back to the account name when the other party is missing or blank', () => {
    expect(transferPartnerLabel(null, ACCOUNT_NAME_SAVINGS)).toBe(ACCOUNT_NAME_SAVINGS)
    expect(transferPartnerLabel('   ', ACCOUNT_NAME_SAVINGS)).toBe(ACCOUNT_NAME_SAVINGS)
  })

  it('formats IBAN values', () => {
    expect(transferPartnerLabel(TEST_IBAN, null)).toBe(TEST_IBAN_FORMATTED)
    expect(transferPartnerLabel(null, TEST_IBAN)).toBe(TEST_IBAN_FORMATTED)
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

describe('compareFlowMembers', () => {
  const flowMember = (over: {
    id: number
    date: string
    amount: number
    accountId?: number
    isMarketValued?: boolean
  }): FlowMemberView => ({
    transaction: buildTransaction({
      id: over.id,
      date: over.date,
      amount: over.amount,
      account_id: over.accountId ?? 42,
    }),
    accountName: null,
    bankName: null,
    bankIcon: null,
    isMarketValued: over.isMarketValued ?? false,
    isCurrent: false,
  })

  it('orders a broker purchase the way the money travels', () => {
    const personalOut = flowMember({ id: 4750, date: '2026-07-14', amount: -AMOUNT_XL })
    const cashIn = flowMember({ id: 5145, date: DATE_BROKER_SETTLE, amount: AMOUNT_XL })
    const cashOut = flowMember({ id: 5146, date: DATE_BROKER_SETTLE, amount: -AMOUNT_XL })
    const depotIn = flowMember({
      id: 5147,
      date: DATE_BROKER_SETTLE,
      amount: AMOUNT_XL,
      isMarketValued: true,
    })

    const ordered = [depotIn, cashOut, personalOut, cashIn].sort(compareFlowMembers)

    expect(ordered.map((m) => m.transaction.id)).toEqual([4750, 5145, 5146, 5147])
  })

  it('shows a same-date transfer as departure before arrival', () => {
    const personalOut = flowMember({
      id: 2,
      date: DATE_SAME_DAY_TRANSFER,
      amount: -AMOUNT_XL,
      accountId: 24,
    })
    const cashIn = flowMember({
      id: 1,
      date: DATE_SAME_DAY_TRANSFER,
      amount: AMOUNT_XL,
      accountId: 20,
    })

    const ordered = [cashIn, personalOut].sort(compareFlowMembers)

    expect(ordered.map((m) => m.transaction.id)).toEqual([2, 1])
  })
})
