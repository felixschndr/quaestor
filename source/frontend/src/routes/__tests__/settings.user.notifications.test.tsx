import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

vi.mock('@/lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push')>()),
  sendTestNotification: vi.fn(),
}))

vi.mock('@/lib/accountGroups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accountGroups')>()),
  useAccountGroupLayout: () => ({ data: undefined }),
}))

import { SettingsNotificationsView } from '@/pages/settings.user.notifications'
import { Route } from '@/routes/settings.user.notifications'
import { ApiError } from '@/lib/api'
import type { AccountRead, CredentialRead } from '@/lib/auth'
import type { NotificationRule } from '@/lib/notificationRules'
import { sendTestNotification, type TestOutcome } from '@/lib/push'
import { settingsQueryKey, type AppSettings } from '@/lib/settings'
import { CATEGORIES_BY_GROUP, TRANSACTION_CATEGORIES, TRANSACTION_TYPES } from '@/lib/transaction'
import { buildUser, jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import {
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_M,
  AMOUNT_S,
  LABEL_GROCERIES,
  LABEL_RENT,
  PARTY_SUPERMARKET,
  money,
} from '@/test/constants'

const CHECKING_ID = 11
const SAVINGS_ID = 12
const RULE_ID = 7

const DEFAULT_DAYS = {
  contract_overdue: 3,
  contract_ending: 30,
  duplicate_transaction: 2,
  upcoming_shortfall: 14,
}
const DEFAULT_DIGEST_WEEKDAY = 4

const SETTINGS: AppSettings = {
  allow_new_user_registration: false,
  default_language: 'en',
  default_currency: 'EUR',
  display_timezone: 'Europe/Berlin',
  sync_interval_hours: 6,
  allowed_attachment_extensions: [],
  max_attachment_size_mb: 10,
  trigger_default_days: DEFAULT_DAYS,
  default_digest_weekday: DEFAULT_DIGEST_WEEKDAY,
}

function buildAccount(id: number, name: string): AccountRead {
  return {
    id,
    name,
    display_name: null,
    balance: 0,
    balance_factor: 100,
    is_archived: false,
    include_by_default: true,
    is_market_valued: false,
  }
}

const CREDENTIALS: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts: [
      buildAccount(CHECKING_ID, ACCOUNT_NAME_CHECKING),
      buildAccount(SAVINGS_ID, ACCOUNT_NAME_SAVINGS),
    ],
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
  },
]

function buildRule(
  fields: Pick<NotificationRule, 'trigger'> & Record<string, unknown>,
): NotificationRule {
  return {
    id: RULE_ID,
    enabled: true,
    include_content: true,
    name: null,
    account_ids: [],
    ...fields,
  } as NotificationRule
}

function buildTransactionRule(fields: Record<string, unknown> = {}): NotificationRule {
  return buildRule({
    trigger: 'transaction',
    other_party_contains: null,
    categories: ['SUPERMARKET'],
    types: ['OUTGOING'],
    min_amount: null,
    max_amount: null,
    ...fields,
  })
}

const ok = () => jsonResponse({ status: 200, body: {} })

function serve(rules: NotificationRule[], respond: () => Response = ok): Mock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') return Promise.resolve(respond())
    if (url === '/api/notification_rules') {
      return Promise.resolve(jsonResponse({ status: 200, body: rules }))
    }
    if (url === '/api/settings') return Promise.resolve(jsonResponse({ status: 404 }))
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function sent(fetchMock: Mock, method: string) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url, body: init.body ? JSON.parse(init.body) : undefined }))
}

async function renderPage(
  rules: NotificationRule[],
  {
    respond = ok,
    settings = SETTINGS,
  }: { respond?: () => Response; settings?: AppSettings | null } = {},
) {
  const fetchMock = serve(rules, respond)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (settings) queryClient.setQueryData(settingsQueryKey, settings)
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsNotificationsView user={buildUser({ credentials: CREDENTIALS })} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  return { fetchMock, user: userEvent.setup() }
}

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest('li')!
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog', { name: /notification/ })
}

async function choose(user: UserEvent, label: string, option: string) {
  await user.click(within(dialog()).getByRole('button', { name: label }))
  const list = await screen.findByRole('list', { name: label })
  await user.click(within(list).getByRole('button', { name: option }))
}

async function checkOnly(user: UserEvent, label: string, option: string) {
  await user.click(within(dialog()).getByRole('button', { name: label }))
  await user.click(screen.getByRole('button', { name: 'None' }))
  const list = await screen.findByRole('list', { name: label })
  await user.click(within(list).getByRole('checkbox', { name: option }))
  await user.keyboard('{Escape}')
}

async function save(user: UserEvent) {
  await user.click(within(dialog()).getByRole('button', { name: 'Save' }))
}

const ALL_ACCOUNTS_DRAFT = { enabled: true, include_content: true, name: null, account_ids: [] }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  toast.success.mockReset()
  toast.error.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SettingsNotificationsView — rule list', () => {
  it('shows the empty state and no filters before any rule exists', async () => {
    await renderPage([])

    expect(screen.getByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Name' })).not.toBeInTheDocument()
  })

  it('shows a loading hint until the rules arrive', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    renderWithQuery(<SettingsNotificationsView user={buildUser({ credentials: CREDENTIALS })} />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('summarises a named transaction rule criterion by criterion', async () => {
    await renderPage([
      buildTransactionRule({
        name: LABEL_GROCERIES,
        account_ids: [SAVINGS_ID],
        other_party_contains: PARTY_SUPERMARKET,
        min_amount: AMOUNT_S,
        max_amount: AMOUNT_M,
        include_content: false,
      }),
    ])

    const row = rowOf(LABEL_GROCERIES)
    expect(row).toHaveTextContent('Trigger: Transaction booked')
    expect(row).toHaveTextContent(`Accounts: ${ACCOUNT_NAME_SAVINGS}`)
    expect(row).toHaveTextContent(`Sender / recipient contains: ${PARTY_SUPERMARKET}`)
    expect(row).toHaveTextContent('Categories: Supermarket')
    expect(row).toHaveTextContent('Types: Outgoing')
    expect(row).toHaveTextContent(`Amount: ${money(AMOUNT_S)} - ${money(AMOUNT_M)}`)
    expect(row).toHaveTextContent('Show details: Account only')
  })

  it.each([
    ['a lower bound only', { min_amount: AMOUNT_S }, [`Amount: From ${money(AMOUNT_S)}`]],
    ['an upper bound only', { max_amount: AMOUNT_M }, [`Amount: Up to ${money(AMOUNT_M)}`]],
    ['no amount bounds', {}, ['Amount: any amount']],
    [
      'every category and type',
      { categories: [...TRANSACTION_CATEGORIES], types: [...TRANSACTION_TYPES] },
      ['Categories: All categories', 'Types: All types'],
    ],
    ['no category and no type', { categories: [], types: [] }, ['Categories: —', 'Types: —']],
  ])('summarises a transaction rule with %s', async (_, fields, lines) => {
    await renderPage([buildTransactionRule(fields)])

    const row = rowOf('Transaction booked')
    for (const line of lines) expect(row).toHaveTextContent(line)
    expect(row).not.toHaveTextContent('Trigger:')
    expect(row).not.toHaveTextContent('Sender / recipient contains')
  })

  it.each([
    ['Summary', { trigger: 'digest', period: 'weekly', weekday: 1 }, ['Period: Weekly (Tuesday)']],
    [
      'Summary',
      { trigger: 'digest', period: 'monthly', weekday: 1 },
      ['Period: Monthly (on the 1st)'],
    ],
    ['Contract overdue', { trigger: 'contract_overdue', days: 5 }, ['Grace period: 5 days']],
    ['Contract ending soon', { trigger: 'contract_ending', days: 1 }, ['Lead time: 1 day']],
    [
      'Possible duplicate booking',
      { trigger: 'duplicate_transaction', days: 2 },
      ['Time window: 2 days'],
    ],
    [
      'Balance below upcoming payments',
      { trigger: 'upcoming_shortfall', days: 14 },
      ['Look ahead: 14 days'],
    ],
    [
      'Balance crosses threshold',
      { trigger: 'balance_threshold', threshold: AMOUNT_L, direction: 'below' },
      ['Direction: Falls below', `Threshold: ${money(AMOUNT_L)}`],
    ],
    [
      'Expected transaction booked',
      { trigger: 'expected_transaction' },
      ['Accounts: All accounts', 'Show details: Details shown'],
    ],
  ] as const)('summarises a %s rule', async (title, fields, lines) => {
    await renderPage([buildRule(fields)])

    const row = rowOf(title)
    for (const line of lines) expect(row).toHaveTextContent(line)
  })

  it.each([
    ['no account (all of them)', [], 'All accounts'],
    ['every account explicitly', [CHECKING_ID, SAVINGS_ID], 'All accounts'],
    ['one account', [CHECKING_ID], ACCOUNT_NAME_CHECKING],
    ['only accounts that no longer exist', [999], 'All accounts'],
  ])('names the accounts of a rule restricted to %s', async (_, accountIds, expected) => {
    await renderPage([buildRule({ trigger: 'contract_detected', account_ids: accountIds })])

    expect(rowOf('New contract detected')).toHaveTextContent(`Accounts: ${expected}`)
  })

  it('shows a rising icon for an upper balance threshold', async () => {
    await renderPage([
      buildRule({ trigger: 'balance_threshold', threshold: AMOUNT_L, direction: 'above' }),
    ])

    const row = rowOf('Balance crosses threshold')
    expect(row).toHaveTextContent('Direction: Rises above')
    expect(row.querySelector('svg.lucide-trending-up')).not.toBeNull()
  })
})

describe('SettingsNotificationsView — filters', () => {
  const rules = [
    buildTransactionRule({ id: 1, name: LABEL_GROCERIES, account_ids: [SAVINGS_ID] }),
    buildRule({
      id: 2,
      trigger: 'expected_transaction',
      name: LABEL_RENT,
      account_ids: [CHECKING_ID],
    }),
  ]

  it('filters by name', async () => {
    const { user } = await renderPage(rules)

    await user.type(screen.getByRole('searchbox', { name: 'Name' }), 'groc')
    expect(screen.getByText(LABEL_GROCERIES)).toBeInTheDocument()
    expect(screen.queryByText(LABEL_RENT)).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Name' }), 'xyz')
    expect(screen.getByText('No notifications match your filters.')).toBeInTheDocument()
  })

  it('filters by trigger', async () => {
    const { user } = await renderPage(rules)
    const trigger = screen.getByRole('button', { name: 'Trigger' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'None' }))
    expect(trigger).toHaveTextContent('No triggers')
    expect(screen.getByText('No notifications match your filters.')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Trigger' })
    await user.click(within(list).getByRole('checkbox', { name: 'Transaction booked' }))
    expect(trigger).toHaveTextContent('1 trigger')
    expect(screen.getByText(LABEL_GROCERIES)).toBeInTheDocument()
    expect(screen.queryByText(LABEL_RENT)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(trigger).toHaveTextContent('All triggers')
    expect(screen.getByText(LABEL_RENT)).toBeInTheDocument()
  })

  it('filters by account', async () => {
    const { user } = await renderPage(rules)
    const accounts = screen.getByRole('button', { name: 'Accounts' })

    await user.click(accounts)
    await user.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.getByText('No notifications match your filters.')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Accounts' })
    await user.click(
      within(within(list).getByText(ACCOUNT_NAME_CHECKING).closest('label')!).getByRole('checkbox'),
    )
    expect(screen.getByText(LABEL_RENT)).toBeInTheDocument()
    expect(screen.queryByText(LABEL_GROCERIES)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(accounts).toHaveTextContent('All accounts')
    expect(screen.getByText(LABEL_GROCERIES)).toBeInTheDocument()
  })
})

describe('SettingsNotificationsView — row actions', () => {
  const rule = buildTransactionRule({ name: LABEL_GROCERIES, account_ids: [SAVINGS_ID] })

  it('switches a rule off by sending the whole rule back', async () => {
    const { fetchMock, user } = await renderPage([rule])

    await user.click(within(rowOf(LABEL_GROCERIES)).getByRole('switch', { name: 'Enabled' }))

    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    const { id, ...draft } = rule
    expect(sent(fetchMock, 'PUT')[0]).toEqual({
      url: `/api/notification_rules/${id}`,
      body: { ...draft, enabled: false },
    })
  })

  it('switches a disabled rule back on', async () => {
    const { fetchMock, user } = await renderPage([{ ...rule, enabled: false }])
    const toggle = within(rowOf(LABEL_GROCERIES)).getByRole('switch', { name: 'Enabled' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
    expect(sent(fetchMock, 'PUT')[0].body).toMatchObject({ enabled: true })
  })

  it('surfaces the server message when the switch is rejected', async () => {
    const { user } = await renderPage([rule], {
      respond: () => jsonResponse({ status: 422, body: { detail: 'Rule is locked' } }),
    })

    await user.click(within(rowOf(LABEL_GROCERIES)).getByRole('switch', { name: 'Enabled' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Rule is locked'))
  })

  it('deletes a rule after confirmation', async () => {
    const { fetchMock, user } = await renderPage([rule])

    await user.click(within(rowOf(LABEL_GROCERIES)).getByRole('button', { name: 'Delete' }))
    expect(sent(fetchMock, 'DELETE')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Notification deleted'))
    expect(sent(fetchMock, 'DELETE')).toEqual([
      { url: `/api/notification_rules/${RULE_ID}`, body: undefined },
    ])
  })

  it('reports a failed delete and keeps the rule', async () => {
    const { user } = await renderPage([rule], { respond: () => jsonResponse({ status: 409 }) })

    await user.click(within(rowOf(LABEL_GROCERIES)).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByText(LABEL_GROCERIES)).toBeInTheDocument()
  })
})

describe('SettingsNotificationsView — test notification', () => {
  it.each<[string, TestOutcome, 'success' | 'error', string]>([
    [
      'an unsupported device',
      { status: 'unsupported' },
      'error',
      'Push notifications are not supported on this device.',
    ],
    [
      'blocked notifications',
      { status: 'denied' },
      'error',
      'Notifications are blocked in your browser settings.',
    ],
    [
      'a delivered push',
      { status: 'done', sent: 1, failed: 0 },
      'success',
      'Test notification sent.',
    ],
    [
      'an undeliverable push with a reason',
      { status: 'done', sent: 0, failed: 1, error: 'Subscription expired' },
      'error',
      'Subscription expired',
    ],
    [
      'an undeliverable push without a reason',
      { status: 'done', sent: 0, failed: 1 },
      'error',
      'Test notification could not be delivered.',
    ],
  ])('reports %s', async (_, outcome, kind, message) => {
    vi.mocked(sendTestNotification).mockResolvedValue(outcome)
    const { user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'Send test' }))

    await waitFor(() => expect(toast[kind]).toHaveBeenCalledWith(message))
  })

  it('reports a failed request and re-enables the button', async () => {
    let fail: (err: unknown) => void = () => {}
    vi.mocked(sendTestNotification).mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    const { user } = await renderPage([])
    const button = screen.getByRole('button', { name: 'Send test' })

    await user.click(button)
    expect(button).toBeDisabled()
    fail(new ApiError(429, null, 'POST /api/push/test → 429'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Too many attempts. Please wait a moment and try again.',
      ),
    )
    expect(button).toBeEnabled()
  })
})

describe('SettingsNotificationsView — install hint', () => {
  const INTRO = /only work when Quaestor is installed as an app/

  it('points desktop users to the install icon', async () => {
    await renderPage([])

    expect(screen.getByText(/install icon in your browser's address bar/)).toBeInTheDocument()
    expect(screen.queryByText(INTRO)).not.toBeInTheDocument()
  })

  it('explains the home-screen install on an iPhone', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    )
    await renderPage([])

    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(screen.getByText(/tap the Share icon/)).toBeInTheDocument()
  })

  it('stays hidden in the installed app', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    await renderPage([])

    expect(screen.queryByText(/install/i)).not.toBeInTheDocument()
  })
})

describe('SettingsNotificationsView — creating a rule', () => {
  it('starts with the first trigger and its configured default period', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    expect(within(dialog()).getByRole('heading', { name: 'New notification' })).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Trigger' })).toHaveTextContent(
      'Balance below upcoming payments',
    )
    expect(within(dialog()).getByLabelText('Look ahead in days')).toHaveValue(
      DEFAULT_DAYS.upcoming_shortfall,
    )
    await save(user)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent(fetchMock, 'POST')).toEqual([
      {
        url: '/api/notification_rules',
        body: {
          ...ALL_ACCOUNTS_DRAFT,
          trigger: 'upcoming_shortfall',
          days: DEFAULT_DAYS.upcoming_shortfall,
        },
      },
    ])
  })

  it.each([
    ['Expected transaction booked', { trigger: 'expected_transaction' }],
    ['Charge after contract end', { trigger: 'contract_charged_after_end' }],
    ['New contract detected', { trigger: 'contract_detected' }],
    ['Contract amount increased', { trigger: 'contract_amount_increased' }],
    ['Contract overdue', { trigger: 'contract_overdue', days: DEFAULT_DAYS.contract_overdue }],
    ['Contract ending soon', { trigger: 'contract_ending', days: DEFAULT_DAYS.contract_ending }],
    [
      'Possible duplicate booking',
      { trigger: 'duplicate_transaction', days: DEFAULT_DAYS.duplicate_transaction },
    ],
    ['Summary', { trigger: 'digest', period: 'monthly', weekday: DEFAULT_DIGEST_WEEKDAY }],
    [
      'Transaction booked',
      {
        trigger: 'transaction',
        other_party_contains: null,
        categories: [...TRANSACTION_CATEGORIES],
        types: [...TRANSACTION_TYPES],
        min_amount: null,
        max_amount: null,
      },
    ],
  ])('creates a "%s" rule with its defaults', async (label, expected) => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', label)
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toEqual({ ...ALL_ACCOUNTS_DRAFT, ...expected })
  })

  it.each([
    ['Contract overdue', 'Grace period in days'],
    ['Contract ending soon', 'Lead time in days'],
    ['Possible duplicate booking', 'Time window in days'],
  ])('labels the period of a "%s" rule as "%s"', async (label, daysLabel) => {
    const { user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', label)

    expect(within(dialog()).getByLabelText(daysLabel)).toBeInTheDocument()
  })

  it('hides the day count for triggers without one', async () => {
    const { user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'New contract detected')

    expect(within(dialog()).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('stores a trimmed name and both switches as set', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await user.type(within(dialog()).getByLabelText('Name (optional)'), `  ${LABEL_GROCERIES}  `)
    await user.click(within(dialog()).getByRole('switch', { name: 'Enabled' }))
    await user.click(within(dialog()).getByRole('switch', { name: 'Show details' }))
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({
      name: LABEL_GROCERIES,
      enabled: false,
      include_content: false,
    })
  })

  it('falls back to the default period when the day count is cleared', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    const days = within(dialog()).getByLabelText('Look ahead in days')
    await user.clear(days)
    expect(days).toHaveValue(DEFAULT_DAYS.upcoming_shortfall)
    await user.tripleClick(days)
    await user.keyboard('7')
    expect(days).toHaveValue(7)
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({ days: 7 })
  })

  it('requires at least one account and keeps an explicit subset', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await user.click(within(dialog()).getByRole('button', { name: 'Accounts' }))
    await user.click(screen.getByRole('button', { name: 'None' }))
    await save(user)

    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Please select at least one account.',
    )
    expect(sent(fetchMock, 'POST')).toEqual([])

    await user.click(within(dialog()).getByRole('button', { name: 'Accounts' }))
    const list = await screen.findByRole('list', { name: 'Accounts' })
    await user.click(
      within(within(list).getByText(ACCOUNT_NAME_SAVINGS).closest('label')!).getByRole('checkbox'),
    )
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument()
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toMatchObject({ account_ids: [SAVINGS_ID] })
  })

  it('requires a threshold for a balance rule', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'Balance crosses threshold')
    await save(user)

    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Please enter a threshold.')
    expect(sent(fetchMock, 'POST')).toEqual([])

    const threshold = within(dialog()).getByLabelText('Threshold')
    await user.type(threshold, '.')
    expect(within(dialog()).getByRole('alert')).toBeInTheDocument()
    await user.clear(threshold)
    await user.type(threshold, String(AMOUNT_L))
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument()
    await choose(user, 'Direction', 'Rises above')
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toEqual({
      ...ALL_ACCOUNTS_DRAFT,
      trigger: 'balance_threshold',
      threshold: AMOUNT_L,
      direction: 'above',
    })
  })

  it('builds a transaction rule from its criteria', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'Transaction booked')
    await user.type(
      within(dialog()).getByLabelText('Sender / recipient contains'),
      ` ${PARTY_SUPERMARKET} `,
    )
    await checkOnly(user, 'Categories', 'Supermarket')
    await checkOnly(user, 'Type', 'Incoming')
    await user.type(within(dialog()).getByLabelText('Amount from'), String(AMOUNT_S))
    await user.type(within(dialog()).getByLabelText('Amount to'), String(AMOUNT_M))
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toEqual({
      ...ALL_ACCOUNTS_DRAFT,
      trigger: 'transaction',
      other_party_contains: PARTY_SUPERMARKET,
      categories: ['SUPERMARKET'],
      types: ['INCOMING'],
      min_amount: AMOUNT_S,
      max_amount: AMOUNT_M,
    })
  })

  it('builds a weekly summary on the chosen weekday', async () => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'Summary')
    expect(within(dialog()).getByText(/aren't included/)).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: 'Weekday' })).not.toBeInTheDocument()

    await choose(user, 'Period', 'Weekly')
    expect(within(dialog()).getByRole('button', { name: 'Weekday' })).toHaveTextContent('Friday')
    await choose(user, 'Weekday', 'Tuesday')
    await save(user)

    await waitFor(() => expect(sent(fetchMock, 'POST')).toHaveLength(1))
    expect(sent(fetchMock, 'POST')[0].body).toEqual({
      ...ALL_ACCOUNTS_DRAFT,
      trigger: 'digest',
      period: 'weekly',
      weekday: 1,
    })
  })

  it('falls back to Sunday summaries when the server settings are unavailable', async () => {
    const { user } = await renderPage([], { settings: null })

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'Summary')
    await choose(user, 'Period', 'Weekly')

    expect(within(dialog()).getByRole('button', { name: 'Weekday' })).toHaveTextContent('Sunday')
  })

  it('refuses a rule identical to an existing one', async () => {
    const { fetchMock, user } = await renderPage([buildRule({ trigger: 'expected_transaction' })])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await choose(user, 'Trigger', 'Expected transaction booked')
    await save(user)

    expect(toast.error).toHaveBeenCalledWith('An identical rule already exists.')
    expect(sent(fetchMock, 'POST')).toEqual([])
    expect(dialog()).toBeInTheDocument()
  })

  it('keeps the dialog open and shows why the server rejected the rule', async () => {
    const { user } = await renderPage([], {
      respond: () => jsonResponse({ status: 422, body: { detail: [{ msg: 'Too many rules' }] } }),
    })

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await save(user)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many rules'))
    expect(dialog()).toBeInTheDocument()
  })

  it.each([
    [
      'the cancel button',
      (user: UserEvent) => user.click(screen.getByRole('button', { name: 'Cancel' })),
    ],
    ['Escape', (user: UserEvent) => user.keyboard('{Escape}')],
  ])('closes without saving via %s', async (_, close) => {
    const { fetchMock, user } = await renderPage([])

    await user.click(screen.getByRole('button', { name: 'New rule' }))
    await close(user)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent(fetchMock, 'POST')).toEqual([])
  })
})

describe('SettingsNotificationsView — editing a rule', () => {
  it('prefills a transaction rule and saves the changes in place', async () => {
    const rule = buildTransactionRule({
      name: LABEL_GROCERIES,
      account_ids: [SAVINGS_ID],
      other_party_contains: PARTY_SUPERMARKET,
      categories: ['HOUSING'],
      min_amount: AMOUNT_S,
    })
    const { fetchMock, user } = await renderPage([rule])

    await user.click(
      within(rowOf(LABEL_GROCERIES)).getByRole('button', { name: 'Edit notification' }),
    )
    expect(within(dialog()).getByRole('heading', { name: 'Edit notification' })).toBeInTheDocument()
    expect(within(dialog()).getByLabelText('Name (optional)')).toHaveValue(LABEL_GROCERIES)
    expect(within(dialog()).getByLabelText('Sender / recipient contains')).toHaveValue(
      PARTY_SUPERMARKET,
    )
    expect(within(dialog()).getByLabelText('Amount from')).toHaveValue(String(AMOUNT_S))
    expect(within(dialog()).getByLabelText('Amount to')).toHaveValue('')

    await user.type(within(dialog()).getByLabelText('Amount to'), String(AMOUNT_M))
    await save(user)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const { id, ...draft } = rule
    expect(sent(fetchMock, 'PUT')).toEqual([
      {
        url: `/api/notification_rules/${id}`,
        body: { ...draft, categories: [...CATEGORIES_BY_GROUP.HOUSING], max_amount: AMOUNT_M },
      },
    ])
  })

  it.each([
    ['Expected transaction booked', { trigger: 'expected_transaction' }, null],
    [
      'Transaction booked',
      {
        trigger: 'transaction',
        other_party_contains: null,
        categories: ['SUPERMARKET'],
        types: ['OUTGOING'],
        min_amount: null,
        max_amount: null,
      },
      ['Sender / recipient contains', ''],
    ],
    ['Summary', { trigger: 'digest', period: 'weekly', weekday: 1 }, ['Weekday', 'Tuesday']],
    ['Contract overdue', { trigger: 'contract_overdue', days: 5 }, ['Grace period in days', 5]],
    [
      'Balance crosses threshold',
      { trigger: 'balance_threshold', threshold: AMOUNT_L, direction: 'above' },
      ['Direction', 'Rises above'],
    ],
  ] as const)(
    'saves an unchanged "%s" rule without flagging it as its own duplicate',
    async (title, fields, shown) => {
      const rule = buildRule(fields)
      const { fetchMock, user } = await renderPage([rule])

      await user.click(within(rowOf(title)).getByRole('button', { name: 'Edit notification' }))
      if (shown?.[0] === 'Weekday' || shown?.[0] === 'Direction') {
        expect(within(dialog()).getByRole('button', { name: shown[0] })).toHaveTextContent(shown[1])
      } else if (shown) {
        expect(within(dialog()).getByLabelText(shown[0])).toHaveValue(shown[1])
      }
      await save(user)

      await waitFor(() => expect(sent(fetchMock, 'PUT')).toHaveLength(1))
      const { id, ...draft } = rule
      expect(sent(fetchMock, 'PUT')[0]).toEqual({
        url: `/api/notification_rules/${id}`,
        body: draft,
      })
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('falls back to the default period for a stored rule without one', async () => {
    const { user } = await renderPage([buildRule({ trigger: 'contract_overdue', days: null })])

    await user.click(
      within(rowOf('Contract overdue')).getByRole('button', { name: 'Edit notification' }),
    )

    expect(within(dialog()).getByLabelText('Grace period in days')).toHaveValue(
      DEFAULT_DAYS.contract_overdue,
    )
  })

  it('prefills the threshold of a balance rule', async () => {
    const { user } = await renderPage([
      buildRule({ trigger: 'balance_threshold', threshold: AMOUNT_L, direction: 'below' }),
    ])

    await user.click(
      within(rowOf('Balance crosses threshold')).getByRole('button', { name: 'Edit notification' }),
    )

    expect(within(dialog()).getByLabelText('Threshold')).toHaveValue(String(AMOUNT_L))
  })
})

describe('SettingsNotificationsPage', () => {
  const Page = Route.options.component!

  function serveMe(response: () => Response) {
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/auth/me' ? response() : jsonResponse({ status: 200, body: [] }),
      ),
    ) as unknown as typeof fetch
  }

  it('shows the notification rules of the signed-in user', async () => {
    serveMe(() => jsonResponse({ status: 200, body: buildUser({ credentials: CREDENTIALS }) }))
    renderWithQuery(<Page />)

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
  })

  it('renders nothing without a session', async () => {
    serveMe(() => jsonResponse({ status: 401, body: { detail: 'Not authenticated' } }))
    const { container } = renderWithQuery(<Page />)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
