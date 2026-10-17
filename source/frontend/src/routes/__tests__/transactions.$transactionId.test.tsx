import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { selectFromPopover } from '@/test/popover-select'
import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const contractMocks = vi.hoisted(() => ({ setContract: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contract')>()),
  useContracts: () => ({
    data: [{ id: 3, account_id: 42, name: 'Netflix', frequency: 'MONTHLY', median_amount: -12.99 }],
  }),
  useSetTransactionContract: () => ({ mutateAsync: contractMocks.setContract, isPending: false }),
}))

import {
  TransactionDetailView,
  otherPartyLabelKey,
  transferPartnerLabel,
} from '@/pages/transactions.$transactionId'
import {
  ContractSection,
  orderRelatedTransactions,
  type RelatedTransactionView,
} from '@/routes/transactions.$transactionId'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_XL,
  DATE_BROKER_FUNDING,
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
    related_transactions: [],
    ...overrides,
  }
}

function relatedTransactionOf(
  transaction: TransactionRead,
  accountName: string | null = ACCOUNT_NAME_SAVINGS,
  isCurrent = false,
  isAccessible = true,
) {
  return {
    transaction,
    accountName,
    bankName: null,
    bankIcon: null,
    isMarketValued: false,
    isCurrent,
    isAccessible,
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
  const relatedTransactions =
    transaction.related_transactions.length > 0
      ? [
          relatedTransactionOf(transaction, ACCOUNT_NAME_GIRO, true),
          ...transaction.related_transactions.map((m) => relatedTransactionOf(m)),
        ]
      : []
  render(
    <TransactionDetailView
      accountId={42}
      transaction={transaction}
      relatedTransactions={relatedTransactions}
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

  it('links the other party to a search for it', () => {
    renderView()
    expect(screen.getByRole('link', { name: PARTY_SUPERMARKET })).toHaveAttribute(
      'href',
      `/search?text=${PARTY_SUPERMARKET}`,
    )
  })

  it('falls back to the em-dash placeholder when other_party / purpose are missing', () => {
    renderView({ other_party: null, purpose: '   ' })
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  it('shows only the date in the header, not the transaction type', () => {
    renderView({ transaction_type: 'OUTGOING' })
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

  it('lists categories under their group headings, pinning UNKNOWN last', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Category'))
    const list = await screen.findByRole('list', { name: 'Category' })
    const entries = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(entries.slice(0, 3)).toEqual(['Income', 'Child benefit & allowance', 'Interest'])
    expect(entries.indexOf('Food & drink')).toBe(entries.indexOf('Side income') + 1)
    expect(entries[entries.length - 1]).toBe('Unknown')
  })

  it('calls onChangeCategory when the user picks a new category', async () => {
    const user = userEvent.setup()
    const { onChangeCategory } = renderView({ category: 'SUPERMARKET' })
    await selectFromPopover(user, 'Category', 'Restaurants')
    expect(onChangeCategory).toHaveBeenCalledWith('RESTAURANTS')
  })

  it('offers resetting a manually set category to the automatic one', async () => {
    const user = userEvent.setup()
    const { onChangeCategory } = renderView({ category_source: 'MANUAL' })
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(onChangeCategory).toHaveBeenCalledWith(null)
  })

  it('shows the rule section next to the category select', () => {
    renderView(
      { category_source: 'MANUAL' },
      { ruleSection: <button type="button">Create rule</button> },
    )
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeInTheDocument()
  })

  it('hides the reset for an automatically assigned category', () => {
    renderView({ category_source: 'AUTO' })
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
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

  it('does not render the related transactions field when the group is empty', () => {
    renderView({ related_transactions: [] })
    expect(screen.queryByText('Related transactions')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument()
  })

  it('renders each related transaction linking to its transaction detail page', () => {
    renderView({ related_transactions: [memberTransaction] })
    const link = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })
    expect(link).toHaveAttribute('href', '/transactions/99')
  })

  it('renders a related transaction we cannot open as plain text instead of a link', () => {
    const transaction = buildTransaction({ related_transactions: [memberTransaction] })
    render(
      <TransactionDetailView
        accountId={42}
        transaction={transaction}
        relatedTransactions={[
          relatedTransactionOf(transaction, ACCOUNT_NAME_GIRO, true),
          relatedTransactionOf(memberTransaction, null, false, false),
        ]}
        onSaveNote={vi.fn()}
        onChangeCategory={vi.fn()}
        onUnlink={vi.fn()}
      />,
    )

    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.getAttribute('href') === '/transactions/99'),
    ).toBe(false)
  })

  const secondMember: TransactionRead = { ...memberTransaction, id: 100, account_id: 56 }

  it('removes the link of a pair right away since there is nothing to choose', async () => {
    const user = userEvent.setup()
    const { onUnlink } = renderView({ related_transactions: [memberTransaction] })
    await user.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(screen.queryByRole('list', { name: 'Remove link' })).toBeNull()
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  async function openUnlinkMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Remove link' }))
    return screen.findByRole('list', { name: 'Remove link' })
  }

  it('offers one unlink menu listing every related transaction instead of a control per row', async () => {
    const user = userEvent.setup()
    renderView({ related_transactions: [memberTransaction, secondMember] })
    expect(screen.getAllByRole('button', { name: 'Remove link' })).toHaveLength(1)

    const menu = await openUnlinkMenu(user)

    expect(within(menu).getAllByRole('listitem')).toHaveLength(3)
    expect(within(menu).getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(within(menu).getAllByText(ACCOUNT_NAME_SAVINGS)).toHaveLength(2)
  })

  it('removes the picked member from the group right away', async () => {
    const user = userEvent.setup()
    const { onUnlink } = renderView({ related_transactions: [memberTransaction, secondMember] })
    const menu = await openUnlinkMenu(user)
    const item = within(menu).getAllByText(ACCOUNT_NAME_SAVINGS)[0].closest('li')!
    await user.click(within(item).getByRole('button', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }))
    expect(onUnlink).toHaveBeenCalledWith(memberTransaction)
  })

  it('hides the remove control while linking is in progress', () => {
    renderView({ related_transactions: [memberTransaction] }, { linking: true })
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull()
    expect(screen.getByText('Related transactions')).toBeInTheDocument()
  })

  it('labels a related transaction with its account name and shows the other party / purpose below', () => {
    renderView({
      related_transactions: [
        { ...memberTransaction, other_party: 'ACME Corp', purpose: 'Invoice 42' },
      ],
    })
    expect(screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })).toBeInTheDocument()
    expect(screen.getByText('ACME Corp · Invoice 42')).toBeInTheDocument()
  })

  it('omits the details line when a member has no other party or purpose', () => {
    renderView({
      related_transactions: [{ ...memberTransaction, other_party: null, purpose: null }],
    })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    expect(within(row).queryByText(/·/)).toBeNull()
  })

  it('renders all related transactions when there are more than one', () => {
    const second: TransactionRead = { ...memberTransaction, id: 100, account_id: 56 }
    renderView({ related_transactions: [memberTransaction, second] })
    const links = screen.getAllByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })
    expect(links).toHaveLength(2)
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/transactions/99',
      '/transactions/100',
    ])
  })

  it('shows the current transaction in the group highlighted and without a link', () => {
    const current: TransactionRead = { ...memberTransaction, id: 7, account_id: 42 }
    renderView(
      { related_transactions: [memberTransaction] },
      {
        relatedTransactions: [
          relatedTransactionOf(current, ACCOUNT_NAME_GIRO, true),
          relatedTransactionOf(memberTransaction),
        ],
      },
    )
    expect(screen.queryByRole('link', { name: new RegExp(ACCOUNT_NAME_GIRO) })).toBeNull()
    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })).toBeInTheDocument()
  })

  it('renders the linkSection slot when the group is empty', () => {
    renderView({ related_transactions: [] }, { linkSection: <div>start-link-slot</div> })
    expect(screen.getByText('start-link-slot')).toBeInTheDocument()
  })

  it('still renders the linkSection alongside an existing group (so more can be added)', () => {
    renderView(
      { related_transactions: [memberTransaction] },
      { linkSection: <div>start-link-slot</div> },
    )
    expect(screen.getByText('start-link-slot')).toBeInTheDocument()
    expect(screen.getByText('Related transactions')).toBeInTheDocument()
  })

  it('renders the linkConfirmSection slot', () => {
    renderView({}, { linkConfirmSection: <div>confirm-link-slot</div> })
    expect(screen.getByText('confirm-link-slot')).toBeInTheDocument()
  })

  it('renders the related transactions field above the note', () => {
    renderView({ related_transactions: [memberTransaction] })
    const terms = screen.getAllByRole('term').map((node) => node.textContent)
    expect(terms).toEqual([
      'Recipient',
      'PurposePurpose',
      'Category',
      'Related transactions',
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

describe('orderRelatedTransactions', () => {
  const relatedTransaction = (over: {
    id: number
    date: string
    amount: number
    accountId?: number
    isMarketValued?: boolean
  }): RelatedTransactionView => ({
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
    isAccessible: true,
  })

  it('orders a broker purchase the way the money travels', () => {
    const personalOut = relatedTransaction({ id: 4750, date: '2026-07-14', amount: -AMOUNT_XL })
    const cashIn = relatedTransaction({ id: 5145, date: DATE_BROKER_SETTLE, amount: AMOUNT_XL })
    const cashOut = relatedTransaction({ id: 5146, date: DATE_BROKER_SETTLE, amount: -AMOUNT_XL })
    const depotIn = relatedTransaction({
      id: 5147,
      date: DATE_BROKER_SETTLE,
      amount: AMOUNT_XL,
      isMarketValued: true,
    })

    const ordered = orderRelatedTransactions([depotIn, cashOut, personalOut, cashIn])

    expect(ordered.map((m) => m.transaction.id)).toEqual([4750, 5145, 5146, 5147])
  })

  it('shows a same-date transfer as departure before arrival', () => {
    const personalOut = relatedTransaction({
      id: 2,
      date: DATE_SAME_DAY_TRANSFER,
      amount: -AMOUNT_XL,
      accountId: 24,
    })
    const cashIn = relatedTransaction({
      id: 1,
      date: DATE_SAME_DAY_TRANSFER,
      amount: AMOUNT_XL,
      accountId: 20,
    })

    const ordered = orderRelatedTransactions([cashIn, personalOut])

    expect(ordered.map((m) => m.transaction.id)).toEqual([2, 1])
  })

  it('spends money on an account only after it arrived there, whatever the booking order', () => {
    // Giro receives 2X and forwards X to savings, savings funds the broker, the broker buys (booked before the deposit)
    const giroIn = relatedTransaction({
      id: 10548,
      date: DATE_BROKER_FUNDING,
      amount: 2 * AMOUNT_XL,
      accountId: 25,
    })
    const giroOut = relatedTransaction({
      id: 10549,
      date: DATE_BROKER_FUNDING,
      amount: -AMOUNT_XL,
      accountId: 25,
    })
    const savingsIn = relatedTransaction({
      id: 10485,
      date: DATE_BROKER_FUNDING,
      amount: AMOUNT_XL,
      accountId: 24,
    })
    const savingsOut = relatedTransaction({
      id: 10578,
      date: DATE_BROKER_SETTLE,
      amount: -AMOUNT_L,
      accountId: 24,
    })
    const cashBuy = relatedTransaction({
      id: 10603,
      date: DATE_BROKER_SETTLE,
      amount: -AMOUNT_M,
      accountId: 20,
    })
    const cashIn = relatedTransaction({
      id: 10604,
      date: DATE_BROKER_SETTLE,
      amount: AMOUNT_L,
      accountId: 20,
    })
    const depotIn = relatedTransaction({
      id: 10605,
      date: DATE_BROKER_SETTLE,
      amount: AMOUNT_M,
      accountId: 21,
      isMarketValued: true,
    })

    const ordered = orderRelatedTransactions([
      depotIn,
      cashIn,
      cashBuy,
      savingsOut,
      savingsIn,
      giroOut,
      giroIn,
    ])

    expect(ordered.map((m) => m.transaction.id)).toEqual([
      10548, 10549, 10485, 10578, 10604, 10603, 10605,
    ])
  })

  it('orders same-account legs in booking order, debit before its later reversal', () => {
    const debit = relatedTransaction({
      id: 5054,
      date: '2026-07-16',
      amount: -AMOUNT_XL,
      accountId: 24,
    })
    const reversal = relatedTransaction({
      id: 5109,
      date: '2026-07-16',
      amount: AMOUNT_XL,
      accountId: 24,
    })

    const ordered = orderRelatedTransactions([reversal, debit])

    expect(ordered.map((m) => m.transaction.id)).toEqual([5054, 5109])
  })
})

describe('ContractSection', () => {
  const assignedTransaction = buildTransaction({ contract_id: 3 })

  it('offers only contracts in the dropdown, removing goes through the unlink button', async () => {
    const user = userEvent.setup()
    render(<ContractSection transaction={assignedTransaction} />)
    await user.click(screen.getByLabelText('Contract'))
    const list = await screen.findByRole('list', { name: 'Contract' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((option) => option.textContent),
    ).toEqual(['Netflix'])
  })

  it('removes the transaction from its contract right away via the unlink button', async () => {
    contractMocks.setContract.mockClear()
    const user = userEvent.setup()
    render(<ContractSection transaction={assignedTransaction} />)
    await user.click(screen.getByRole('button', { name: 'Remove from contract' }))
    expect(contractMocks.setContract).toHaveBeenCalledWith({
      transactionId: assignedTransaction.id,
      fromContractId: 3,
      toContractId: null,
    })
  })

  it('shows no unlink button when the transaction has no contract', () => {
    render(<ContractSection transaction={buildTransaction({ contract_id: null })} />)
    expect(screen.getByLabelText('Contract')).toHaveTextContent('No contract')
    expect(screen.queryByRole('button', { name: 'Remove from contract' })).toBeNull()
  })

  it('drops the create link while offline when the account has no contracts', () => {
    onlineManager.setOnline(false)
    render(
      <ContractSection transaction={buildTransaction({ account_id: 99, contract_id: null })} />,
    )
    expect(screen.getByText('No contracts on this account')).toHaveClass('text-muted-foreground')
    expect(screen.queryByRole('link')).toBeNull()
    onlineManager.setOnline(true)
  })
})
