import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { CredentialRead } from '@/lib/auth'
import type { ContractRead } from '@/lib/contract'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_M,
  AMOUNT_S,
  AMOUNT_XL,
  CONTRACT_NAME,
  CONTRACT_NAME_GYM,
  DATE_MID_MONTH,
  DATE_NEXT_RUN,
  DATE_OLDER,
  LABEL_RENT,
  LABEL_SALARY,
  PARTY_SUPERMARKET,
} from '@/test/constants'
import { buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'
import { buildAccount, buildContract, buildCredential } from '@/test/statsFixtures'

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
import { Route } from '@/routes/contracts'

const ContractsPage = Route.options.component!
const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => unknown

const GIRO_ID = 42
const SAVINGS_ID = 43
const credentials = [
  buildCredential([
    buildAccount({ id: GIRO_ID, name: ACCOUNT_NAME_GIRO }),
    buildAccount({ id: SAVINGS_ID, name: ACCOUNT_NAME_SAVINGS, include_by_default: false }),
  ]),
]

const contracts = [
  buildContract({
    id: 1,
    name: CONTRACT_NAME,
    median_amount: -AMOUNT_S,
    amount_per_day: -1,
    expected_next_date: DATE_NEXT_RUN,
  }),
  buildContract({ id: 7, name: LABEL_RENT, median_amount: null }),
  buildContract({ id: 3, name: LABEL_SALARY, median_amount: AMOUNT_XL, amount_per_day: 50 }),
  buildContract({
    id: 4,
    name: PARTY_SUPERMARKET,
    median_amount: null,
    expected_next_date: DATE_OLDER,
  }),
  buildContract({
    id: 2,
    name: CONTRACT_NAME_GYM,
    median_amount: -AMOUNT_M,
    amount_per_day: -2,
    expected_next_date: DATE_MID_MONTH,
  }),
  buildContract({ id: 5, name: 'Archived', is_archived: true }),
  buildContract({ id: 6, name: 'Savings plan', account_id: SAVINGS_ID }),
]

const fetchMock = vi.fn()

function serve({
  list = contracts,
  creds = credentials,
  createStatus = 201,
}: { list?: ContractRead[]; creds?: CredentialRead[]; createStatus?: number } = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    switch (key) {
      case 'GET /api/contracts?include_archived=true':
        return Promise.resolve(jsonResponse({ status: 200, body: list }))
      case 'GET /api/auth/me':
        return Promise.resolve(
          jsonResponse({ status: 200, body: buildUser({ credentials: creds }) }),
        )
      case 'GET /api/account_groups/layout':
        return Promise.resolve(jsonResponse({ status: 200, body: { groups: [], ungrouped: [] } }))
      case 'POST /api/contracts':
        return Promise.resolve(
          jsonResponse({ status: createStatus, body: { ...contracts[0], id: 99, members: [] } }),
        )
      default:
        return Promise.reject(new Error(`unexpected fetch: ${key}`))
    }
  })
}

async function renderPage(search: Record<string, unknown> = {}) {
  routeState.search = search
  renderWithQuery(<ContractsPage />)
  await screen.findByRole('heading', { level: 1, name: 'Contracts' })
}

async function shownIds(): Promise<string[]> {
  const table = (await screen.findAllByRole('table'))[0]
  return within(table)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href')!.replace('/contracts/', ''))
}

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  serve()
})

describe('ContractsPage — search params', () => {
  it('coerces URL values into typed filters', () => {
    expect(
      validateSearch({
        account_ids: '42',
        amount_from: '-100',
        frequencies: 'NONE',
        overdue: ['OVERDUE'],
        status: 'ARCHIVED',
        sort: 'name',
      }),
    ).toEqual({
      account_ids: [42],
      amount_from: -100,
      frequencies: ['NONE'],
      overdue: ['OVERDUE'],
      status: ['ARCHIVED'],
      sort: 'name',
    })
  })

  it('rejects an unknown sort order', () => {
    expect(() => validateSearch({ sort: 'random' })).toThrow()
  })
})

describe('ContractsPage — list', () => {
  it('explains when nothing has been detected yet', async () => {
    serve({ list: [] })
    await renderPage()

    expect(await screen.findByText('No contracts detected yet.')).toBeInTheDocument()
    expect(screen.queryByText('Advanced filters')).not.toBeInTheDocument()
  })

  it('shows active contracts of the default accounts, cheapest first', async () => {
    await renderPage()

    expect(await screen.findByRole('heading', { name: '5 contracts' })).toBeInTheDocument()
    expect(await shownIds()).toEqual(['2', '1', '3', '7', '4'])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/contracts?include_archived=true',
      expect.anything(),
    )
  })

  it('says so when the filters match nothing', async () => {
    await renderPage({ text: 'does not exist' })

    expect(await screen.findByText('No contracts match your filters.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows archived contracts when the status filter asks for them', async () => {
    await renderPage({ status: ['ARCHIVED'] })

    expect(await screen.findByRole('heading', { name: '1 contract' })).toBeInTheDocument()
    expect(await shownIds()).toEqual(['5'])
  })

  it.each([
    ['name', ['2', '1', '7', '4', '3']],
    ['amount_desc', ['3', '1', '2', '7', '4']],
    ['per_day_in', ['3', '1', '2', '7', '4']],
    ['per_day_out', ['2', '1', '3', '7', '4']],
    ['next', ['4', '2', '1', '7', '3']],
  ])('sorts by %s', async (sort, expected) => {
    await renderPage({ sort })

    await screen.findByRole('heading', { name: '5 contracts' })
    expect(await shownIds()).toEqual(expected)
  })

  it('stores a new sort order in the URL, dropping the default', async () => {
    const user = userEvent.setup()
    await renderPage({ text: 'e', sort: 'name' })
    await screen.findByRole('heading', { name: /contracts?$/ })

    const chooseSort = async (label: string) => {
      await user.click(screen.getByLabelText('Sort by'))
      const list = await screen.findByRole('list', { name: 'Sort by' })
      await user.click(within(list).getByRole('button', { name: label }))
    }

    await chooseSort('Next payment')
    expect(navigate).toHaveBeenLastCalledWith({
      search: { text: 'e', sort: 'next' },
      replace: true,
    })

    await chooseSort('Amount ascending')
    expect(navigate).toHaveBeenLastCalledWith({
      search: { text: 'e', sort: undefined },
      replace: true,
    })
  })

  it('keeps the sort order when a filter changes', async () => {
    const user = userEvent.setup()
    await renderPage({ sort: 'next' })
    await screen.findByRole('heading', { name: '5 contracts' })

    await user.type(screen.getByRole('searchbox', { name: 'Name' }), 'n')

    expect(navigate).toHaveBeenCalledWith({ search: { text: 'n', sort: 'next' }, replace: true })
  })
})

async function openCreateDialog(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'New contract' }))
  return screen.findByRole('dialog')
}

async function pick(user: UserEvent, dialog: HTMLElement, trigger: string, option: string) {
  await user.click(within(dialog).getByLabelText(trigger))
  const list = await screen.findByRole('list', { name: trigger })
  await user.click(within(list).getByRole('button', { name: option }))
}

describe('ContractsPage — create', () => {
  it('cannot create a contract without any account', async () => {
    serve({ creds: [] })
    await renderPage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything()))
    expect(screen.getByRole('button', { name: 'New contract' })).toBeDisabled()
  })

  it('creates a contract with frequency and category and opens it', async () => {
    const user = userEvent.setup()
    await renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeEnabled())

    const dialog = await openCreateDialog(user)
    const submit = within(dialog).getByRole('button', { name: 'New contract' })
    expect(submit).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Name'), `  ${CONTRACT_NAME_GYM}  `)
    expect(submit).toBeDisabled()
    await pick(user, dialog, 'Accounts', ACCOUNT_NAME_SAVINGS)
    await pick(user, dialog, 'Frequency', 'Quarterly')
    await pick(user, dialog, 'Category', 'Streaming')
    await user.click(submit)

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/contracts/$contractId',
        params: { contractId: '99' },
      }),
    )
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({
      name: CONTRACT_NAME_GYM,
      account_id: SAVINGS_ID,
      frequency: 'QUARTERLY',
      category: 'STREAMING',
    })
    expect(toast.promise).toHaveBeenCalledWith(expect.any(Promise), {
      loading: 'Saving …',
      success: 'Contract created',
      error: 'Something went wrong',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves irregular frequency and unknown category out of the request', async () => {
    const user = userEvent.setup()
    await renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeEnabled())

    const dialog = await openCreateDialog(user)
    await user.type(within(dialog).getByLabelText('Name'), CONTRACT_NAME)
    await pick(user, dialog, 'Accounts', ACCOUNT_NAME_GIRO)
    await user.click(within(dialog).getByRole('button', { name: 'New contract' }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ name: CONTRACT_NAME, account_id: GIRO_ID })
  })

  it('keeps the dialog open when creating fails', async () => {
    const user = userEvent.setup()
    serve({ createStatus: 500 })
    await renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeEnabled())

    const dialog = await openCreateDialog(user)
    await user.type(within(dialog).getByLabelText('Name'), CONTRACT_NAME)
    await pick(user, dialog, 'Accounts', ACCOUNT_NAME_GIRO)
    await user.click(within(dialog).getByRole('button', { name: 'New contract' }))

    const [promise] = toast.promise.mock.calls[0]
    await expect(promise).rejects.toThrow()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('discards the dialog on cancel', async () => {
    const user = userEvent.setup()
    await renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New contract' })).toBeEnabled())

    const dialog = await openCreateDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
})
