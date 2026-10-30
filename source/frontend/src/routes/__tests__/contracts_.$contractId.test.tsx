import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { ContractDetailRead, ContractMemberRead } from '@/lib/contract'
import { formatDate, formatDateWithoutYear } from '@/lib/format'
import { selectFromPopover } from '@/test/popover-select'
import {
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  CONTRACT_NAME,
  CONTRACT_NAME_GYM,
  DATE_MID_MONTH,
  DATE_NEXT_RUN,
  DATE_OLDER,
  DATE_RECENT,
  DATE_YESTERDAY,
  PARTY_SUPERMARKET,
  TODAY,
  money,
} from '@/test/constants'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => {
    promise.catch(() => {})
  }),
}))
vi.mock('sonner', () => ({ toast }))

import { routeState } from './-routerMock'
import { Route } from '@/routes/contracts_.$contractId'

const CONTRACT_ID = 7
const CONTRACT_URL = `/api/contracts/${CONTRACT_ID}`
const ContractDetailPage = Route.options.component!

function buildMember(overrides: Partial<ContractMemberRead> = {}): ContractMemberRead {
  return {
    id: 100,
    account_id: 42,
    amount: -AMOUNT_M,
    purpose: null,
    date: DATE_RECENT,
    other_party: PARTY_SUPERMARKET,
    transaction_type: null,
    category: 'UNKNOWN',
    note: null,
    contract_assignment: 'AUTO',
    is_outlier: false,
    ...overrides,
  }
}

function buildContract(overrides: Partial<ContractDetailRead> = {}): ContractDetailRead {
  return {
    id: CONTRACT_ID,
    account_id: 42,
    name: CONTRACT_NAME,
    note: null,
    category: null,
    source: 'DETECTED',
    median_amount: -AMOUNT_M,
    frequency: 'MONTHLY',
    expected_next_date: DATE_NEXT_RUN,
    end_date: null,
    is_archived: false,
    is_overdue: false,
    amount_per_day: null,
    amount_per_frequency: null,
    members: [],
    ...overrides,
  }
}

const fetchMock = vi.fn()

function serve(contract: ContractDetailRead | null, failing: string[] = []) {
  let stored = contract
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url !== CONTRACT_URL) return Promise.reject(new Error(`unexpected fetch: ${url}`))
    if (failing.includes(method)) return Promise.resolve(jsonResponse({ status: 500, body: {} }))
    if (method === 'GET') {
      return Promise.resolve(
        stored
          ? jsonResponse({ status: 200, body: stored })
          : jsonResponse({ status: 404, body: { detail: 'Not found' } }),
      )
    }
    if (method === 'PATCH') {
      stored = { ...stored!, ...JSON.parse(String(init?.body)) }
      return Promise.resolve(jsonResponse({ status: 200, body: stored }))
    }
    return Promise.resolve(new Response(null, { status: 204 }))
  })
}

function sentBodies(method: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') === method)
    .map(([, init]) => (init?.body === undefined ? undefined : JSON.parse(String(init.body))))
}

async function renderPage(contract: ContractDetailRead | null, failing: string[] = []) {
  serve(contract, failing)
  const view = renderWithQuery(<ContractDetailPage />)
  if (contract) await screen.findByRole('heading', { level: 1, name: contract.name })
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  globalThis.fetch = fetchMock as unknown as typeof fetch
  routeState.params = { contractId: String(CONTRACT_ID) }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ContractDetailPage — loading and not found', () => {
  it('renders nothing while the contract is still loading', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { container } = renderWithQuery(<ContractDetailPage />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).toHaveBeenCalledWith(CONTRACT_URL, expect.anything())
  })

  it('shows the not-found view with a way back when the contract does not exist', async () => {
    await renderPage(null)

    expect(await screen.findByText('The contract you seek, this is not.')).toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Back to contracts' })
    expect(back).toHaveAttribute('href', '/contracts')
    expect(back).toHaveAttribute('data-replace', 'true')
  })
})

describe('ContractDetailPage — overview', () => {
  it('shows the median, payment dates and the member list', async () => {
    await renderPage(
      buildContract({
        members: [
          buildMember({ id: 1, date: DATE_RECENT, other_party: PARTY_SUPERMARKET }),
          buildMember({ id: 2, date: DATE_OLDER, other_party: null, amount: AMOUNT_S }),
        ],
      }),
    )

    expect(screen.getByText(money(-AMOUNT_M), { selector: 'section > span' })).toHaveClass(
      'text-destructive',
    )
    expect(screen.getByText('Last payment').nextSibling).toHaveTextContent(
      formatDateWithoutYear(DATE_RECENT),
    )
    expect(screen.getByText('Next payment').nextSibling).toHaveTextContent(
      formatDateWithoutYear(DATE_NEXT_RUN),
    )
    expect(screen.getByRole('heading', { name: '2 transactions' })).toBeInTheDocument()
    expect(screen.getByLabelText('Payment history')).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/transactions/1')
    expect(rows[0]).toHaveTextContent(PARTY_SUPERMARKET)
    expect(rows[0]).toHaveTextContent(formatDate(DATE_RECENT))
    expect(rows[1]).toHaveTextContent('Unknown')
    expect(within(rows[1]).getByText(money(AMOUNT_S))).toHaveClass('text-success')
    expect(screen.queryByLabelText('Frequency')).not.toBeInTheDocument()
  })

  it('skips excluded members for the last payment and the chart, and flags outliers', async () => {
    await renderPage(
      buildContract({
        members: [
          buildMember({ id: 1, date: DATE_YESTERDAY, contract_assignment: 'EXCLUDED' }),
          buildMember({ id: 2, date: DATE_OLDER, is_outlier: true, amount: -AMOUNT_L }),
        ],
      }),
    )

    expect(screen.getByText('Last payment').nextSibling).toHaveTextContent(
      formatDateWithoutYear(DATE_OLDER),
    )
    expect(screen.queryByLabelText('Payment history')).not.toBeInTheDocument()
    expect(screen.getByText(money(-AMOUNT_L))).toHaveClass('text-warning')
    expect(screen.getByRole('heading', { name: '2 transactions' })).toBeInTheDocument()
  })

  it('shows placeholders when there is no median, payment or next date yet', async () => {
    await renderPage(buildContract({ median_amount: null, expected_next_date: null }))

    expect(screen.getByText('Last payment').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('Next payment').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('No transactions assigned yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '0 transactions' })).toBeInTheDocument()
    expect(screen.queryByText('Normalized')).not.toBeInTheDocument()
  })

  it('colours a positive median as income', async () => {
    await renderPage(buildContract({ median_amount: AMOUNT_L }))

    expect(screen.getByText(money(AMOUNT_L))).toHaveClass('text-success')
  })

  it('lists the normalized amounts and highlights the billing frequency', async () => {
    await renderPage(
      buildContract({
        frequency: 'YEARLY',
        amount_per_day: null,
        amount_per_frequency: {
          WEEKLY: -AMOUNT_S,
          BIWEEKLY: -2 * AMOUNT_S,
          MONTHLY: -AMOUNT_M,
          QUARTERLY: -3 * AMOUNT_M,
          YEARLY: -12 * AMOUNT_M,
        },
      }),
    )

    expect(screen.getByRole('heading', { name: 'Normalized' })).toBeInTheDocument()
    const term = (label: string) => screen.getByText(label, { selector: 'dt' })
    expect(term('Day').nextSibling).toHaveTextContent('—')
    expect(term('Week').nextSibling).toHaveTextContent(money(-AMOUNT_S))
    expect(term('Month').nextSibling).toHaveTextContent(money(-AMOUNT_M))
    expect(term('Year').nextSibling).toHaveTextContent(money(-12 * AMOUNT_M))
    expect(term('Year')).toHaveClass('text-destructive')
    expect(term('Month')).toHaveClass('text-muted-foreground')
  })

  it('colours the highlighted projection green for income', async () => {
    await renderPage(
      buildContract({
        median_amount: AMOUNT_L,
        amount_per_day: AMOUNT_S,
        amount_per_frequency: {
          WEEKLY: AMOUNT_S,
          BIWEEKLY: AMOUNT_S,
          MONTHLY: AMOUNT_L,
          QUARTERLY: AMOUNT_L,
          YEARLY: AMOUNT_L,
        },
      }),
    )

    expect(screen.getByText('Month', { selector: 'dt' })).toHaveClass('text-success')
    expect(screen.getByText('Day', { selector: 'dt' }).nextSibling).toHaveTextContent(
      money(AMOUNT_S),
    )
  })
})

describe('ContractDetailPage — overdue and archive', () => {
  it('warns about an overdue payment and archives the contract', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ is_overdue: true, expected_next_date: DATE_MID_MONTH }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'The next payment is 7 days overdue. Is this contract still active?',
    )
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Next payment').nextSibling?.firstChild).toHaveClass('text-warning')

    await user.click(screen.getByRole('button', { name: 'Archive contract' }))

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, archived: true }]),
    )
    expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), {
      loading: 'Saving …',
      success: 'Archived',
      error: 'Something went wrong',
    })
  })

  it('shows an archived contract without schedule and restores it', async () => {
    const user = userEvent.setup()
    await renderPage(
      buildContract({
        is_archived: true,
        is_overdue: true,
        members: [buildMember({ id: 1 }), buildMember({ id: 2, date: DATE_OLDER })],
      }),
    )

    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('Last payment')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive contract' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, archived: false }]),
    )
    expect(toast.promise).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.objectContaining({ success: 'Restored' }),
    )
  })

  it('offers no archive toggle for an active, current contract', async () => {
    await renderPage(buildContract())

    expect(screen.queryByRole('button', { name: 'Archive contract' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })
})

describe('ContractDetailPage — rename', () => {
  it('renames via Enter, trimming the name and keeping the category', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ category: 'STREAMING' }))

    await user.click(screen.getByRole('button', { name: 'Rename contract' }))
    const input = screen.getByRole('textbox', { name: 'Rename contract' })
    expect(input).toHaveFocus()
    expect(input).toHaveValue(CONTRACT_NAME)
    expect(screen.queryByText(money(-AMOUNT_M))).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename contract' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, `  ${CONTRACT_NAME_GYM}  {Enter}`)

    expect(await screen.findByRole('heading', { name: CONTRACT_NAME_GYM })).toBeInTheDocument()
    expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME_GYM, category: 'STREAMING' }])
    expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), {
      loading: 'Saving …',
      success: 'Contract renamed',
      error: 'Something went wrong',
    })
  })

  it('renames via the save button', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())

    await user.click(screen.getByRole('button', { name: 'Rename contract' }))
    const input = screen.getByRole('textbox', { name: 'Rename contract' })
    await user.clear(input)
    await user.type(input, CONTRACT_NAME_GYM)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME_GYM, category: null }]),
    )
  })

  it('reports a failed rename through the toast', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract(), ['PATCH'])

    await user.click(screen.getByRole('button', { name: 'Rename contract' }))
    const input = screen.getByRole('textbox', { name: 'Rename contract' })
    await user.clear(input)
    await user.type(input, `${CONTRACT_NAME_GYM}{Enter}`)

    const [promise] = toast.promise.mock.calls[0]
    await expect(promise).rejects.toThrow()
    expect(screen.getByRole('heading', { name: CONTRACT_NAME })).toBeInTheDocument()
  })

  it('closes without saving on Escape, on cancel, or when the name is unchanged or blank', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())
    const rename = () => user.click(screen.getByRole('button', { name: 'Rename contract' }))
    const input = () => screen.getByRole('textbox', { name: 'Rename contract' })

    await rename()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(input(), '{Enter}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await rename()
    await user.type(input(), 'x{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await rename()
    await user.clear(input())
    await user.type(input(), '   ')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: CONTRACT_NAME })).toBeInTheDocument()
    expect(sentBodies('PATCH')).toEqual([])
    expect(toast.promise).not.toHaveBeenCalled()
  })
})

describe('ContractDetailPage — editable fields', () => {
  it('changes the category, keeping the name', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())

    await selectFromPopover(user, 'Category', 'Streaming')

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, category: 'STREAMING' }]),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('reports a failed category change', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract(), ['PATCH'])

    await selectFromPopover(user, 'Category', 'Streaming')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update the category'))
    expect(screen.getByLabelText('Category')).toBeEnabled()
  })

  it('lets a manual contract change its frequency, mapping "Irregular" to null', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ source: 'MANUAL', category: 'RENT' }))

    await selectFromPopover(user, 'Frequency', 'Yearly')
    await waitFor(() => expect(sentBodies('PATCH')).toHaveLength(1))
    await selectFromPopover(user, 'Frequency', 'Irregular')

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([
        { name: CONTRACT_NAME, category: 'RENT', frequency: 'YEARLY' },
        { name: CONTRACT_NAME, category: 'RENT', frequency: null },
      ]),
    )
  })

  it('reports a failed frequency change', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ source: 'MANUAL', frequency: null }), ['PATCH'])

    await selectFromPopover(user, 'Frequency', 'Monthly')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong'))
    expect(screen.getByLabelText('Frequency')).toBeEnabled()
  })

  it('sets an end date from the calendar', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())

    expect(screen.queryByRole('button', { name: 'Remove end date' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No end date' }))
    await user.click(await screen.findByRole('button', { name: /May 15th, 2026/ }))

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, end_date: DATE_MID_MONTH }]),
    )
  })

  it('removes an existing end date', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ end_date: DATE_NEXT_RUN }))

    expect(screen.getByRole('button', { name: formatDate(DATE_NEXT_RUN) })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove end date' }))

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, end_date: null }]),
    )
  })

  it('reports a failed end date change', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ end_date: DATE_NEXT_RUN }), ['PATCH'])

    await user.click(screen.getByRole('button', { name: 'Remove end date' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong'))
    expect(screen.getByRole('button', { name: 'Remove end date' })).toBeEnabled()
  })

  it('auto-saves the note with name and category', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract({ category: 'RENT' }))

    await user.click(screen.getByRole('button', { name: 'Edit note' }))
    await user.type(screen.getByRole('textbox'), 'hi')

    await waitFor(() =>
      expect(sentBodies('PATCH')).toEqual([{ name: CONTRACT_NAME, category: 'RENT', note: 'hi' }]),
    )
  })
})

describe('ContractDetailPage — delete', () => {
  it('deletes after confirmation and returns to the list', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())

    await user.click(screen.getByRole('button', { name: 'Delete contract' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/contracts', replace: true }))
    expect(sentBodies('DELETE')).toEqual([undefined])
    expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), {
      loading: 'Saving …',
      success: 'Contract deleted',
      error: 'Something went wrong',
    })
  })

  it('stays on the page when the delete fails', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract(), ['DELETE'])

    await user.click(screen.getByRole('button', { name: 'Delete contract' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    const [promise] = toast.promise.mock.calls[0]
    await expect(promise).rejects.toThrow()
    expect(await screen.findByRole('button', { name: 'Delete contract' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('can back out of the delete confirmation', async () => {
    const user = userEvent.setup()
    await renderPage(buildContract())

    await user.click(screen.getByRole('button', { name: 'Delete contract' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete contract' })).toBeInTheDocument()
    expect(sentBodies('DELETE')).toEqual([])
  })
})
