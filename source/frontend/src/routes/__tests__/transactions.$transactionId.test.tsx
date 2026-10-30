import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import { selectFromPopover } from '@/test/popover-select'
import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'

const { navigate, toast } = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), promise: vi.fn() },
}))
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({ useNavigate: () => navigate }),
)
vi.mock('sonner', () => ({ toast }))

const NETFLIX_CONTRACT = {
  id: 3,
  account_id: 42,
  name: CONTRACT_NAME,
  frequency: 'MONTHLY',
  median_amount: -12.99,
}
const contractMocks = vi.hoisted(() => ({
  setContract: vi.fn().mockResolvedValue(undefined),
  contracts: undefined as unknown[] | undefined,
}))
vi.mock('@/lib/contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/contract')>()),
  useContracts: () => ({ data: contractMocks.contracts }),
  useSetTransactionContract: () => ({ mutateAsync: contractMocks.setContract, isPending: false }),
}))

import { TransactionDetailView, transferPartnerLabel } from '@/pages/transactions.$transactionId'
import {
  ContractSection,
  Route,
  orderRelatedTransactions,
  type RelatedTransactionView,
} from '@/routes/transactions.$transactionId'
import type { CredentialRead } from '@/lib/auth'
import type { AttachmentRead } from '@/lib/attachment'
import { formatDate, formatMoney } from '@/lib/format'
import { routeState } from './-routerMock'
import { bodyOf, buildUser, jsonResponse, renderWithQuery, requestsTo } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_XL,
  CONTRACT_NAME,
  CONTRACT_NAME_GYM,
  DATETIME_RECENT,
  DATE_BROKER_FUNDING,
  DATE_BROKER_SETTLE,
  DATE_RECENT,
  DATE_SAME_DAY_TRANSFER,
  PARTY_SUPERMARKET,
  SHARE_OWNER_NAME,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
  money,
} from '@/test/constants'

beforeEach(() => {
  contractMocks.contracts = [NETFLIX_CONTRACT]
})

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

  it.each([
    ['negative', -AMOUNT_M, /text-destructive/],
    ['positive', AMOUNT_XL, /text-success/],
  ])('shows a %s amount in its colour', (_label, amount, colour) => {
    renderView({ amount })
    expect(screen.getByText(money(amount)).className).toMatch(colour)
  })

  it('badges a refunded transaction', () => {
    renderView({ refund_status: 'refunded' })
    expect(screen.getByText('Refunded')).toBeInTheDocument()
  })

  it('shows no refund badge for an unrefunded transaction', () => {
    renderView()
    expect(screen.queryByText('Refunded')).toBeNull()
  })

  it('renders all fields in the table in the documented order', () => {
    // amount: -AMOUNT_M (outgoing) → "Recipient" label
    renderView()
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts).toEqual(['Recipient', 'PurposePurpose', 'Category', 'Account', 'Note'])
  })

  it.each([
    ['"Sender" for incoming amounts', AMOUNT_L, 'Sender'],
    ['the neutral combined label for an amount of exactly zero', 0, 'Other party'],
  ])('labels the other-party row %s', (_label, amount, label) => {
    renderView({ amount })
    const dts = screen.getAllByRole('term').map((node) => node.textContent)
    expect(dts[0]).toBe(label)
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

  it('shows the direction icon in place of amounts that differ only in sign', () => {
    renderView({ related_transactions: [memberTransaction] })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    expect(within(row).queryByText(new RegExp(String(AMOUNT_M)))).toBeNull()
    expect(within(row).getAllByLabelText('Incoming')).toHaveLength(2)
  })

  it('shows the amounts when they differ', () => {
    renderView({ related_transactions: [{ ...memberTransaction, amount: AMOUNT_M / 2 }] })
    const row = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }).closest('li')!
    expect(within(row).getByText(new RegExp(String(AMOUNT_M / 2)))).toBeInTheDocument()
    expect(within(row).getAllByLabelText('Incoming')).toHaveLength(1)
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
  })
})

describe('TransactionDetailView — failures', () => {
  it('toasts when the category cannot be changed', async () => {
    const user = userEvent.setup()
    const { onChangeCategory } = renderView()
    onChangeCategory.mockRejectedValueOnce(new Error('boom'))

    await selectFromPopover(user, 'Category', 'Restaurants')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update the category'))
    expect(screen.getByLabelText('Category')).toBeEnabled()
  })

  it('toasts when a link cannot be removed', async () => {
    const user = userEvent.setup()
    const member: TransactionRead = { ...buildTransaction(), id: 99, account_id: 55 }
    const { onUnlink } = renderView({ related_transactions: [member] })
    onUnlink.mockRejectedValueOnce(new Error('boom'))

    await user.click(screen.getByRole('button', { name: 'Remove link' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not remove the link'))
    expect(screen.getByRole('button', { name: 'Remove link' })).toBeEnabled()
  })

  it('shows the note read-only to someone who may not edit it', () => {
    renderView({ note: `  ${PARTY_SUPERMARKET}  ` }, { canWrite: false })
    expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull()
    expect(screen.getByText(PARTY_SUPERMARKET, { selector: 'span' })).toBeInTheDocument()
  })
})

describe('ContractSection — states', () => {
  it('shows a placeholder while the contracts load', () => {
    contractMocks.contracts = undefined
    render(<ContractSection transaction={buildTransaction()} />)
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('points to the contracts page when the account has none yet', () => {
    contractMocks.contracts = []
    render(<ContractSection transaction={buildTransaction({ contract_id: null })} />)
    expect(
      screen.getByRole('link', { name: 'No contracts on this account — create one first' }),
    ).toHaveAttribute('href', '/contracts')
  })

  it('links the assigned contract with its frequency and typical amount', () => {
    render(<ContractSection transaction={buildTransaction({ contract_id: 3 })} />)
    expect(screen.getByRole('link', { name: `Monthly · ${formatMoney(-12.99)}` })).toHaveAttribute(
      'href',
      '/contracts/3',
    )
  })

  it('calls an assigned contract without a rhythm or amount irregular', () => {
    contractMocks.contracts = [{ ...NETFLIX_CONTRACT, frequency: null, median_amount: null }]
    render(<ContractSection transaction={buildTransaction({ contract_id: 3 })} />)
    expect(screen.getByRole('link', { name: 'Irregular' })).toBeInTheDocument()
  })

  it('still offers the unlink button for a contract of another account', () => {
    contractMocks.contracts = [{ ...NETFLIX_CONTRACT, account_id: 55 }]
    render(<ContractSection transaction={buildTransaction({ contract_id: 3 })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove from contract' })).toBeInTheDocument()
  })

  it('moves the transaction to another contract, but not to the one it is in', async () => {
    const user = userEvent.setup()
    contractMocks.contracts = [
      NETFLIX_CONTRACT,
      { ...NETFLIX_CONTRACT, id: 4, name: CONTRACT_NAME_GYM },
    ]
    render(<ContractSection transaction={buildTransaction({ contract_id: 3 })} />)

    await selectFromPopover(user, 'Contract', CONTRACT_NAME)
    expect(contractMocks.setContract).not.toHaveBeenCalled()

    await selectFromPopover(user, 'Contract', CONTRACT_NAME_GYM)
    expect(contractMocks.setContract).toHaveBeenCalledWith({
      transactionId: 7,
      fromContractId: 3,
      toContractId: 4,
    })
    expect(toast.promise).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.objectContaining({ success: 'Added to contract' }),
    )
  })
})

describe('TransactionDetailPage', () => {
  const Page = Route.options.component!

  const giro = buildAccount({
    id: 42,
    name: TEST_IBAN,
    display_name: ACCOUNT_NAME_GIRO,
    balance: AMOUNT_XL,
  })
  const savings = buildAccount({ id: 55, name: ACCOUNT_NAME_SAVINGS })

  function fintsCredential(overrides: Partial<CredentialRead> = {}) {
    return buildCredential([giro, savings], {
      id: 100,
      bank: 'fints',
      bank_name: 'ING',
      ...overrides,
    })
  }

  const SETTINGS = { allowed_attachment_extensions: ['pdf'], max_attachment_size_mb: 1 }
  const ATTACHMENTS_URL = '/api/account/42/transactions/7/attachments'

  function serve(routes: Record<string, unknown>) {
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const route = routes[`${init?.method ?? 'GET'} ${String(input)}`]
      if (route === undefined) return new Promise<Response>(() => {})
      return Promise.resolve(
        typeof route === 'function'
          ? (route as () => Response)()
          : jsonResponse({ status: 200, body: route }),
      )
    }) as unknown as typeof fetch
  }

  function renderPage({
    transaction = buildTransaction(),
    credential = fintsCredential(),
    attachments = [] as AttachmentRead[],
    settings = SETTINGS as object,
    search = {} as Record<string, unknown>,
    routes = {} as Record<string, unknown>,
  } = {}) {
    routeState.params = { transactionId: String(transaction.id) }
    routeState.search = search
    serve({
      [`GET /api/transactions/${transaction.id}`]: transaction,
      'GET /api/auth/me': buildUser({ credentials: [credential] }),
      'GET /api/settings': settings,
      [`GET ${ATTACHMENTS_URL}`]: attachments,
      ...routes,
    })
    return renderWithQuery(<Page />)
  }

  const readShare = { shared_from: SHARE_OWNER_NAME, share_permission: 'read' as const }

  it('renders nothing while the transaction loads', () => {
    routeState.params = { transactionId: '7' }
    routeState.search = {}
    serve({})
    const { container } = renderWithQuery(<Page />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the not-found page for a transaction that does not exist', async () => {
    renderPage({
      routes: { 'GET /api/transactions/7': () => jsonResponse({ status: 404, body: {} }) },
    })
    expect(await screen.findByText('The transaction you seek, this is not.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
  })

  it('shows the transaction under its personalised account name', async () => {
    renderPage()
    const accountLinks = await screen.findAllByRole('link', { name: ACCOUNT_NAME_GIRO })
    expect(accountLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/account/42',
      '/account/42',
    ])
    expect(screen.getByText(money(-AMOUNT_M))).toBeInTheDocument()
  })

  it('names an account without a personalised name by its formatted IBAN', async () => {
    renderPage({
      credential: fintsCredential({ accounts: [{ ...giro, display_name: '  ' }] }),
    })
    expect(await screen.findAllByRole('link', { name: TEST_IBAN_FORMATTED })).not.toHaveLength(0)
  })

  it('still shows a transaction whose account the user cannot see anymore', async () => {
    renderPage({ credential: fintsCredential({ accounts: [savings] }) })
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/account/42')
  })

  it('reads the link source from the URL search', () => {
    const validateSearch = Route.options.validateSearch as (search: object) => object
    expect(validateSearch({ link_account_id: '55', link_transaction_id: '99' })).toEqual({
      link_account_id: 55,
      link_transaction_id: 99,
    })
    expect(validateSearch({})).toEqual({})
  })

  it('saves a changed category on the transaction', async () => {
    const user = userEvent.setup()
    renderPage({
      routes: {
        'PATCH /api/account/42/transactions/7': buildTransaction({ category: 'RESTAURANTS' }),
      },
    })
    await screen.findByLabelText('Category')

    await selectFromPopover(user, 'Category', 'Restaurants')

    await waitFor(() =>
      expect(requestsTo('PATCH', '/api/account/42/transactions/7')).toHaveLength(1),
    )
    expect(bodyOf('PATCH', '/api/account/42/transactions/7')).toEqual({ category: 'RESTAURANTS' })
  })

  it('saves an edited note on the transaction', async () => {
    const user = userEvent.setup()
    renderPage({
      routes: { 'PATCH /api/account/42/transactions/7': buildTransaction({ note: 'x' }) },
    })

    await user.click(await screen.findByRole('button', { name: 'Edit note' }))
    await user.type(screen.getByRole('textbox'), 'x')

    await waitFor(() =>
      expect(requestsTo('PATCH', '/api/account/42/transactions/7')).toHaveLength(1),
    )
    expect(bodyOf('PATCH', '/api/account/42/transactions/7')).toEqual({ note: 'x' })
  })

  it('lists related transactions, opening only those on accessible accounts', async () => {
    renderPage({
      transaction: buildTransaction({
        related_transactions: [
          { ...buildTransaction(), id: 99, account_id: 55, amount: AMOUNT_M, other_party: null },
          { ...buildTransaction(), id: 100, account_id: 77, amount: AMOUNT_M, other_party: null },
        ],
      }),
    })

    expect(await screen.findByRole('link', { name: ACCOUNT_NAME_SAVINGS })).toHaveAttribute(
      'href',
      '/transactions/99',
    )
    expect(screen.getByText('Other account')).toBeInTheDocument()
    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.getAttribute('href') === '/transactions/100'),
    ).toBe(false)
  })

  it('unlinks the picked member of a group through its own account', async () => {
    const user = userEvent.setup()
    renderPage({
      transaction: buildTransaction({
        related_transactions: [
          { ...buildTransaction(), id: 99, account_id: 55, amount: AMOUNT_M },
          { ...buildTransaction(), id: 100, account_id: 77, amount: AMOUNT_L },
        ],
      }),
      routes: {
        'DELETE /api/account/55/transactions/99/related-link': () =>
          new Response(null, { status: 204 }),
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Remove link' }))
    const menu = await screen.findByRole('list', { name: 'Remove link' })
    await user.click(within(menu).getByRole('button', { name: new RegExp(ACCOUNT_NAME_SAVINGS) }))

    await waitFor(() =>
      expect(requestsTo('DELETE', '/api/account/55/transactions/99/related-link')).toHaveLength(1),
    )
  })

  it('offers a rule for a manually categorised transaction of the owner', async () => {
    const user = userEvent.setup()
    renderPage({ transaction: buildTransaction({ category_source: 'MANUAL' }) })

    await user.click(await screen.findByRole('button', { name: 'Create rule' }))
    expect(screen.getByText(/get the category “Supermarket”/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/get the category “Supermarket”/)).toBeNull()
  })

  it('offers linking another transaction, disabled while offline', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: 'Add transaction' })).toHaveAttribute(
      'href',
      '/search?link_account_id=42&link_transaction_id=7',
    )

    act(() => onlineManager.setOnline(false))
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeDisabled()
  })

  it('keeps a pending transaction free of contracts, attachments and links', async () => {
    renderPage({ transaction: buildTransaction({ pending: true }) })
    expect(
      await screen.findByText('Pending — not finally booked yet and may still change'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Contract')).toBeNull()
    expect(screen.queryByText('Attachments')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add transaction' })).toBeNull()
  })

  it('shows a transaction shared read-only without any editing', async () => {
    renderPage({
      credential: fintsCredential(readShare),
      attachments: [
        {
          id: 1,
          filename: 'invoice.pdf',
          content_type: null,
          size: 1,
          created_at: DATETIME_RECENT,
        },
      ],
    })

    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).toBeNull()
    expect(screen.getByText('Supermarket')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull()
    expect(screen.queryByText('Contract')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add transaction' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete attachment' })).toBeNull()
  })

  describe('linking', () => {
    const source = { ...buildTransaction(), id: 99, account_id: 55, other_party: null }

    it.each([
      [55, ACCOUNT_NAME_SAVINGS],
      [77, 'Other account'],
    ])(
      'links a transaction from account %s with this one and opens the source',
      async (sourceAccountId, partner) => {
        const user = userEvent.setup()
        const sourceUrl = `/api/account/${sourceAccountId}/transactions/99`
        renderPage({
          search: { link_account_id: sourceAccountId, link_transaction_id: 99 },
          routes: {
            [`GET ${sourceUrl}`]: { ...source, account_id: sourceAccountId },
            [`PUT ${sourceUrl}/related-link`]: source,
          },
        })

        expect(
          await screen.findByText(
            `Link this transaction with ${partner} · ${money(source.amount)} · ${formatDate(source.date)}?`,
          ),
        ).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Add transaction' })).toBeNull()

        await user.click(screen.getByRole('button', { name: 'Link transaction' }))

        await waitFor(() =>
          expect(navigate).toHaveBeenCalledWith({
            to: '/transactions/$transactionId',
            params: { transactionId: '99' },
          }),
        )
        expect(bodyOf('PUT', `${sourceUrl}/related-link`)).toEqual({
          counterpart_account_id: 42,
          counterpart_transaction_id: 7,
        })
        expect(toast.promise).toHaveBeenCalledWith(
          expect.any(Promise),
          expect.objectContaining({ success: 'Transactions linked' }),
        )
      },
    )

    it('does not offer linking a pending source', async () => {
      renderPage({
        search: { link_account_id: 55, link_transaction_id: 99 },
        routes: { 'GET /api/account/55/transactions/99': { ...source, pending: true } },
      })
      await screen.findByLabelText('Category')
      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/account/55/transactions/99',
          expect.anything(),
        ),
      )
      expect(screen.queryByRole('button', { name: 'Link transaction' })).toBeNull()
    })

    it('offers nothing to link while viewing the source itself', async () => {
      renderPage({ search: { link_account_id: 42, link_transaction_id: 7 } })
      await screen.findByLabelText('Category')
      expect(screen.queryByRole('button', { name: 'Link transaction' })).toBeNull()
      expect(screen.queryByRole('link', { name: 'Add transaction' })).toBeNull()
    })
  })

  describe('attachments', () => {
    const attachment = (id: number, filename: string, size: number): AttachmentRead => ({
      id,
      filename,
      content_type: 'application/pdf',
      size,
      created_at: DATETIME_RECENT,
    })

    const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

    function file(name: string, size = 1): File {
      const result = new File(['x'], name)
      Object.defineProperty(result, 'size', { value: size })
      return result
    }

    it('lists attachments as downloads with their size', async () => {
      renderPage({
        attachments: [
          attachment(1, 'invoice.pdf', 512),
          attachment(2, 'scan.pdf', 2048),
          attachment(3, 'contract.pdf', 1.5 * 1024 * 1024),
        ],
      })

      const download = (await screen.findByText('invoice.pdf')).closest('a')!
      expect(download).toHaveAttribute('href', `${ATTACHMENTS_URL}/1`)
      expect(download).toHaveAttribute('download', 'invoice.pdf')
      expect(screen.getByText(/· 512 B$/)).toBeInTheDocument()
      expect(screen.getByText(/· 2 KB$/)).toBeInTheDocument()
      expect(screen.getByText(/· 1\.5 MB$/)).toBeInTheDocument()
    })

    it('deletes an attachment and reloads the list', async () => {
      const user = userEvent.setup()
      renderPage({
        attachments: [attachment(1, 'invoice.pdf', 512)],
        routes: { [`DELETE ${ATTACHMENTS_URL}/1`]: () => new Response(null, { status: 204 }) },
      })

      await user.click(await screen.findByRole('button', { name: 'Delete attachment' }))

      await waitFor(() => expect(requestsTo('GET', ATTACHMENTS_URL)).toHaveLength(2))
      expect(requestsTo('DELETE', `${ATTACHMENTS_URL}/1`)).toHaveLength(1)
    })

    it('opens the file picker from "Add file"', async () => {
      const user = userEvent.setup()
      renderPage()
      const pick = vi.spyOn(HTMLInputElement.prototype, 'click')

      await user.click(await screen.findByRole('button', { name: 'Add file' }))

      expect(pick).toHaveBeenCalledOnce()
      expect(screen.getByText('No attachments')).toBeInTheDocument()
    })

    it('uploads the picked files and reloads the list', async () => {
      const user = userEvent.setup()
      renderPage({
        attachments: [attachment(1, 'invoice.pdf', 512)],
        routes: { [`POST ${ATTACHMENTS_URL}`]: [] },
      })
      await screen.findByText('invoice.pdf')
      expect(fileInput()).toHaveAttribute('accept', '.pdf')

      await user.upload(fileInput(), file('receipt.pdf'))

      await waitFor(() => expect(requestsTo('GET', ATTACHMENTS_URL)).toHaveLength(2))
      const [[, init]] = requestsTo('POST', ATTACHMENTS_URL)
      expect((init?.body as FormData).getAll('files').map((part) => (part as File).name)).toEqual([
        'receipt.pdf',
      ])
    })

    it.each([
      ['a type that is not allowed', file('notes.exe'), 'File type not allowed'],
      [
        'a file over the size limit',
        file('big.pdf', 2 * 1024 * 1024),
        'File too large (maximum 1 MB)',
      ],
    ])('rejects %s before uploading', async (_label, picked, message) => {
      const user = userEvent.setup({ applyAccept: false })
      renderPage()
      await screen.findByText('No attachments')

      await user.upload(fileInput(), picked)

      expect(toast.error).toHaveBeenCalledWith(message)
      expect(requestsTo('POST', ATTACHMENTS_URL)).toHaveLength(0)
    })

    it('ignores a picker closed without a file', async () => {
      renderPage()
      await screen.findByText('No attachments')

      fireEvent.change(fileInput(), { target: { files: [] } })

      expect(requestsTo('POST', ATTACHMENTS_URL)).toHaveLength(0)
    })

    it.each([
      [415, SETTINGS, 'File type not allowed'],
      [413, SETTINGS, 'File too large (maximum 1 MB)'],
      [413, { allowed_attachment_extensions: [], max_attachment_size_mb: 0 }, 'File too large'],
      [500, SETTINGS, 'Upload failed'],
    ])('explains a %s upload rejection', async (status, settings, message) => {
      const user = userEvent.setup()
      renderPage({
        settings,
        routes: { [`POST ${ATTACHMENTS_URL}`]: () => jsonResponse({ status, body: {} }) },
      })
      await screen.findByText('No attachments')

      await user.upload(fileInput(), file('receipt.pdf'))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    })
  })
})
