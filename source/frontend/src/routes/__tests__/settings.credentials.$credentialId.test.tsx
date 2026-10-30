import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import '@/i18n'

const routerReplace = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { replace: routerReplace } }),
  }),
)

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuthMe: vi.fn(),
}))
vi.mock('@/components/sync-provider', () => ({ useCredentialSync: vi.fn() }))

import { CredentialDetailView } from '@/pages/settings.credentials.$credentialId'
import { Route } from '@/routes/settings.credentials.$credentialId'
import { useAuthMe, type AccountRead, type CredentialRead, type UserRead } from '@/lib/auth'
import { useCredentialSync } from '@/components/sync-provider'
import type { AccountShareRecipient } from '@/lib/accountShares'
import { routeState } from './-routerMock'
import {
  bodyOf,
  buildUser,
  jsonResponse,
  renderWithQuery,
  requestsTo,
  serve,
  type Served,
} from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import {
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_XL,
  DATETIME_RECENT,
  LABEL_SAVINGS,
  SHARE_OWNER_NAME,
  SHARE_RECIPIENT_NAME,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
} from '@/test/constants'

const CREDENTIAL_URL = '/api/credentials/42'
const ACCOUNT_URL = '/api/account/1'

function account(overrides: Partial<AccountRead> = {}): AccountRead {
  return buildAccount({ id: 1, name: TEST_IBAN_FORMATTED, ...overrides })
}

function credential(overrides: Partial<CredentialRead> = {}): CredentialRead {
  return buildCredential([], { id: 42, bank: 'fints', ...overrides })
}

const ONE_ACCOUNT = { accounts: [account()] }

function renderView(
  overrides: Partial<CredentialRead> = {},
  props: Partial<ComponentProps<typeof CredentialDetailView>> = {},
) {
  return renderWithQuery(
    <CredentialDetailView credential={credential(overrides)} onDeleted={vi.fn()} {...props} />,
  )
}

function mutatingFetchCalls() {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([, init]) => init?.method && init.method !== 'GET',
  )
}

function serveAccountPatch() {
  serve({ [`PATCH ${ACCOUNT_URL}`]: { status: 200, body: { id: 1 } } })
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  document.cookie = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CredentialDetailView', () => {
  it('renders a not-found fallback when the credential is missing', () => {
    renderView({}, { credential: undefined })
    expect(screen.getByText('The connection you seek, this is not.')).toBeInTheDocument()
  })

  it('shows the bank header with logo, title and last-synced timestamp', () => {
    renderView({
      bank: 'trade_republic',
      bank_icon: '/static/banks/trade-republic.png',
      last_successful_sync_timestamp: DATETIME_RECENT,
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trade Republic')
    expect(document.querySelector('img[src="/static/banks/trade-republic.png"]')).not.toBeNull()
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
  })

  it('says "never synced" when last_successful_sync_timestamp is null', () => {
    renderView()
    expect(screen.getByText('Never synced')).toBeInTheDocument()
  })

  it.each(['Sync bank connection', 'sync now'])(
    'starts a sync from "%s" even before the first sync produced any accounts',
    async (name) => {
      const onSyncClick = vi.fn()
      renderView({}, { onSyncClick })
      expect(screen.getByText(/Never synced,/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name }))
      expect(onSyncClick).toHaveBeenCalledOnce()
    },
  )

  it('drops the sync button, caption and automatic-sync status on a manual credential', () => {
    renderView({ bank: 'manual' }, { onSyncClick: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Sync bank connection' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Never synced/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not synced automatically/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-hour schedule/)).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('explains the last sync failure with its reason and the raw bank message', () => {
    renderView({
      last_successful_sync_timestamp: DATETIME_RECENT,
      last_sync_error: 'Error during dialog initialization, PIN wrong?',
      last_sync_error_code: 'invalid_credentials',
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Automatic sync failed')
    expect(alert).toHaveTextContent('The bank rejected the login.')
    expect(alert).toHaveTextContent('Error during dialog initialization, PIN wrong?')
  })

  it('shows no failure notice while the credential syncs fine', () => {
    renderView({ last_successful_sync_timestamp: DATETIME_RECENT })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders an empty-accounts hint when there are no accounts', () => {
    renderView()
    expect(
      screen.getByText('No accounts yet. They appear after the first successful sync.'),
    ).toBeInTheDocument()
  })

  it('renders one row per account with a balance_factor input pre-filled', () => {
    renderView({
      accounts: [
        account({ name: ACCOUNT_NAME_GIRO, balance_factor: 100 }),
        account({ id: 2, name: LABEL_SAVINGS, balance_factor: 50 }),
      ],
    })
    expect(screen.getByText(ACCOUNT_NAME_GIRO)).toBeInTheDocument()
    expect(screen.getByText(LABEL_SAVINGS)).toBeInTheDocument()
    const inputs = screen.getAllByLabelText('Balance factor') as HTMLInputElement[]
    expect(inputs.map((input) => input.value)).toEqual(['100', '50'])
  })

  it('auto-saves the balance_factor after the user pauses typing', async () => {
    const user = userEvent.setup()
    serveAccountPatch()
    renderView({ accounts: [account({ name: ACCOUNT_NAME_GIRO, balance_factor: 100 })] })

    const input = screen.getByLabelText('Balance factor')
    await user.clear(input)
    await user.type(input, '60.3')

    await waitFor(() => expect(bodyOf('PATCH', ACCOUNT_URL)).toEqual({ balance_factor: 60.3 }), {
      timeout: 2000,
    })
  })

  it('flags values out of range as invalid and does not auto-save them', async () => {
    const user = userEvent.setup()
    renderView({ accounts: [account({ balance_factor: 100 })] })

    const input = screen.getByLabelText('Balance factor')
    await user.clear(input)
    await user.type(input, '150')

    expect(screen.getByRole('alert')).toHaveTextContent('The value must between 0 and 100.')
    // Give the debounce a chance to fire — invalid input must not produce a PATCH.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(mutatingFetchCalls()).toHaveLength(0)
  })

  it('does not show a save button — the form auto-saves silently', () => {
    renderView(ONE_ACCOUNT)
    // The only buttons should be the danger-zone delete button.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).not.toContain('Save')
  })

  it('requires an explicit confirm before calling DELETE', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    serve({ [`DELETE ${CREDENTIAL_URL}`]: { status: 204 } })
    renderView({}, { onDeleted })

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    // The first click flips to confirm mode; DELETE isn't sent yet.
    expect(mutatingFetchCalls()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(requestsTo('DELETE', CREDENTIAL_URL)).toHaveLength(1)
  })

  it('cancels the delete confirmation when the user clicks cancel', async () => {
    const user = userEvent.setup()
    renderView()

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete connection' })).toBeInTheDocument()
    expect(mutatingFetchCalls()).toHaveLength(0)
  })

  it('pre-fills the personalised name input from the server value', () => {
    renderView({ accounts: [account({ display_name: ACCOUNT_NAME_CHECKING })] })
    expect(screen.getByLabelText('Personalised name')).toHaveValue(ACCOUNT_NAME_CHECKING)
  })

  it('shows the personalised name as the card title with the IBAN as subtitle', () => {
    renderView({ accounts: [account({ name: TEST_IBAN, display_name: ACCOUNT_NAME_CHECKING })] })
    expect(screen.getByText(ACCOUNT_NAME_CHECKING)).toBeInTheDocument()
    expect(screen.getByText(TEST_IBAN_FORMATTED)).toBeInTheDocument()
  })

  it('auto-PATCHes display_name when only the personalised name changes', async () => {
    const user = userEvent.setup()
    serveAccountPatch()
    renderView({ accounts: [account({ display_name: null, balance_factor: 100 })] })

    await user.type(screen.getByLabelText('Personalised name'), ACCOUNT_NAME_SAVINGS)

    // balance_factor not in the payload — sending it would touch a value the
    // user didn't intend to change.
    await waitFor(
      () => expect(bodyOf('PATCH', ACCOUNT_URL)).toEqual({ display_name: ACCOUNT_NAME_SAVINGS }),
      { timeout: 2000 },
    )
  })

  it('auto-clears the personalised name by sending null when the user empties the input', async () => {
    const user = userEvent.setup()
    serveAccountPatch()
    renderView({ accounts: [account({ display_name: ACCOUNT_NAME_CHECKING })] })

    await user.clear(screen.getByLabelText('Personalised name'))

    await waitFor(() => expect(bodyOf('PATCH', ACCOUNT_URL)).toEqual({ display_name: null }), {
      timeout: 2000,
    })
  })

  it('debounces — a single PATCH covers a burst of edits to both fields', async () => {
    const user = userEvent.setup()
    serveAccountPatch()
    renderView({ accounts: [account({ display_name: null, balance_factor: 100 })] })

    await user.type(screen.getByLabelText('Personalised name'), ACCOUNT_NAME_SAVINGS)
    const factorInput = screen.getByLabelText('Balance factor')
    await user.clear(factorInput)
    await user.type(factorInput, '50')

    await waitFor(
      () => {
        // Exactly one PATCH for the whole burst — debounce coalesces edits.
        expect(requestsTo('PATCH', ACCOUNT_URL)).toHaveLength(1)
        expect(bodyOf('PATCH', ACCOUNT_URL)).toEqual({
          balance_factor: 50,
          display_name: ACCOUNT_NAME_SAVINGS,
        })
      },
      { timeout: 2000 },
    )
  })

  it.each([
    [false, 2, 'These accounts are synced automatically on a 12-hour schedule.'],
    [false, 1, 'This account is synced automatically on a 12-hour schedule.'],
    [true, 2, 'These accounts are not synced automatically because a second factor is required.'],
    [true, 1, 'This account is not synced automatically because a second factor is required.'],
  ])(
    'states the automatic-sync status (2FA required: %s, %i accounts)',
    async (requiresTwoFactor, accountCount, text) => {
      serve({
        'GET /api/settings': {
          status: 200,
          body: {
            allow_new_user_registration: true,
            default_language: 'en',
            display_timezone: 'UTC',
            sync_interval_hours: 12,
          },
        },
      })
      renderView({
        requires_two_factor_authentication: requiresTwoFactor,
        accounts: [account(), account({ id: 2 })].slice(0, accountCount),
      })

      expect(await screen.findByText(text)).toBeInTheDocument()
      expect(requestsTo('GET', '/api/settings')).toHaveLength(requiresTwoFactor ? 0 : 1)
    },
  )
})

const SAVE_FAILED = 'Could not save the changes. Please try again.'

describe('CredentialDetailView — sync settings', () => {
  it('saves the "sync all" opt-out and confirms it', async () => {
    const user = userEvent.setup()
    serve({ [`PATCH ${CREDENTIAL_URL}`]: { status: 200, body: credential() } })
    renderView()

    const checkbox = screen.getByRole('checkbox', { name: 'Include when syncing all accounts' })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Saved'))
    expect(bodyOf('PATCH', CREDENTIAL_URL)).toEqual({ sync_enabled: false })
    expect(checkbox).not.toBeChecked()
  })

  it('reverts the checkbox and toasts when saving the opt-out fails', async () => {
    const user = userEvent.setup()
    serve({ [`PATCH ${CREDENTIAL_URL}`]: { status: 500, body: {} } })
    renderView()

    const checkbox = screen.getByRole('checkbox', { name: 'Include when syncing all accounts' })
    await user.click(checkbox)

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(SAVE_FAILED))
    expect(checkbox).toBeChecked()
  })

  it('follows server-side changes to the checkboxes', () => {
    const { rerender } = renderView(ONE_ACCOUNT)

    rerender(
      <CredentialDetailView
        credential={credential({
          sync_enabled: false,
          accounts: [account({ is_archived: true, include_by_default: false })],
        })}
        onDeleted={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('checkbox', { name: 'Include when syncing all accounts' }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Archive' })).toBeChecked()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select by default' })).not.toBeChecked()
  })

  it('falls back to the generic reason for an unknown sync error code', () => {
    renderView({
      last_sync_error_code: 'brand_new_code' as CredentialRead['last_sync_error_code'],
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The bank reported an unexpected error:')
    expect(alert.querySelectorAll('p')).toHaveLength(2)
  })

  it('disables the sync button and drops the "sync now" link while a sync runs', () => {
    renderView({}, { onSyncClick: vi.fn(), syncBusy: true })
    expect(screen.getByRole('button', { name: 'Sync bank connection' })).toBeDisabled()
    expect(screen.getByText('Never synced')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sync now' })).not.toBeInTheDocument()
  })
})

describe('CredentialDetailView — account toggles', () => {
  it.each([
    ['Archive', { is_archived: true }],
    ['Select by default', { include_by_default: false }],
  ])('saves "%s" right away', async (label, payload) => {
    const user = userEvent.setup()
    serve({ [`PATCH ${ACCOUNT_URL}`]: { status: 200, body: account() } })
    renderView(ONE_ACCOUNT)

    await user.click(screen.getByRole('checkbox', { name: label }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Saved'))
    expect(bodyOf('PATCH', ACCOUNT_URL)).toEqual(payload)
  })

  it.each([
    ['Archive', false],
    ['Select by default', true],
  ])('reverts "%s" when saving fails', async (label, initiallyChecked) => {
    const user = userEvent.setup()
    serve({ [`PATCH ${ACCOUNT_URL}`]: { status: 500, body: {} } })
    renderView(ONE_ACCOUNT)

    const checkbox = screen.getByRole('checkbox', { name: label })
    await user.click(checkbox)

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(SAVE_FAILED))
    if (initiallyChecked) expect(checkbox).toBeChecked()
    else expect(checkbox).not.toBeChecked()
  })

  it('toasts when the debounced auto-save fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    serve({ [`PATCH ${ACCOUNT_URL}`]: { status: 500, body: {} } })
    renderView(ONE_ACCOUNT)

    await user.type(screen.getByLabelText('Personalised name'), ACCOUNT_NAME_SAVINGS)
    await act(() => vi.advanceTimersByTimeAsync(600))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(SAVE_FAILED))
    expect(requestsTo('PATCH', ACCOUNT_URL)).toHaveLength(1)
  })
})

describe('CredentialDetailView — manual accounts', () => {
  const manual = (accounts: AccountRead[] = []): Partial<CredentialRead> => ({
    bank: 'manual',
    accounts,
  })

  it('opens the add-account form right away while the credential is empty', () => {
    renderView(manual())

    expect(
      screen.getByText('No accounts yet. Create your first manual account.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Account name')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(screen.queryByText('Shares')).not.toBeInTheDocument()
  })

  it('creates an account with the entered starting balance and closes the form', async () => {
    const user = userEvent.setup()
    let respond: (response: Response) => void = () => {}
    serve({}, () => new Promise((resolve) => (respond = resolve)))
    renderView(manual())

    await user.type(screen.getByLabelText('Account name'), `  ${ACCOUNT_NAME_CHECKING} `)
    await user.type(screen.getByLabelText('Starting balance'), String(AMOUNT_XL))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled()
    expect(bodyOf('POST', '/api/account')).toEqual({
      credential_id: 42,
      name: ACCOUNT_NAME_CHECKING,
      balance: AMOUNT_XL,
    })
    await act(async () => respond(jsonResponse({ status: 201, body: account() })))

    expect(await screen.findByRole('button', { name: 'Add account' })).toBeInTheDocument()
    expect(toastMock.success).toHaveBeenCalledWith('Account created')
  })

  it('defaults the starting balance to zero', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/account': { status: 201, body: account() } })
    renderView(manual())

    await user.type(screen.getByLabelText('Account name'), `${ACCOUNT_NAME_CHECKING}{Enter}`)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Account created'))
    expect(bodyOf('POST', '/api/account')).toMatchObject({ balance: 0 })
  })

  it('keeps the form open and toasts when creating fails', async () => {
    const user = userEvent.setup()
    serve({ 'POST /api/account': { status: 500, body: {} } })
    renderView(manual())

    await user.type(screen.getByLabelText('Account name'), ACCOUNT_NAME_CHECKING)
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Could not create account.'))
    expect(screen.getByLabelText('Account name')).toHaveValue(ACCOUNT_NAME_CHECKING)
  })

  it('opens the form on demand once accounts exist and resets it on cancel', async () => {
    const user = userEvent.setup()
    renderView(manual([account({ name: ACCOUNT_NAME_GIRO })]))

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Account name'), ACCOUNT_NAME_CHECKING)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    expect(screen.getByLabelText('Account name')).toHaveValue('')
    expect(requestsTo('POST', '/api/account')).toHaveLength(0)
  })

  it('deletes a manual account after confirmation', async () => {
    const user = userEvent.setup()
    serve({ [`DELETE ${ACCOUNT_URL}`]: { status: 204 } })
    renderView(manual([account({ name: ACCOUNT_NAME_GIRO })]))

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(`Account deleted: ${ACCOUNT_NAME_GIRO}`),
    )
  })

  it('toasts when deleting a manual account fails', async () => {
    const user = userEvent.setup()
    serve({ [`DELETE ${ACCOUNT_URL}`]: { status: 500, body: {} } })
    renderView(manual([account()]))

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Could not delete account.'))
  })
})

describe('CredentialDetailView — deleting the connection', () => {
  it('stays on the page and toasts when the delete fails', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    serve({ [`DELETE ${CREDENTIAL_URL}`]: { status: 500, body: {} } })
    renderView({}, { onDeleted })

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Could not delete the connection. Please try again.',
      ),
    )
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('confirms the deletion with the bank name', async () => {
    const user = userEvent.setup()
    serve({ [`DELETE ${CREDENTIAL_URL}`]: { status: 204 } })
    renderView({ bank: 'trade_republic' })

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Connection deleted: Trade Republic'),
    )
  })
})

describe('CredentialDetailView — sharing an own account', () => {
  const SHARES_URL = '/api/account_shares/account/1'
  const RECIPIENT_ID = 7

  function share(overrides: Partial<AccountShareRecipient> = {}): AccountShareRecipient {
    return {
      id: 5,
      user_id: RECIPIENT_ID,
      display_name: SHARE_RECIPIENT_NAME,
      permission: 'read',
      status: 'accepted',
      ...overrides,
    }
  }

  function serveShares(shares: AccountShareRecipient[], extra: Served = {}) {
    serve({
      [`GET ${SHARES_URL}`]: { status: 200, body: shares },
      'GET /api/account_shares/users': {
        status: 200,
        body: [{ id: RECIPIENT_ID, display_name: SHARE_RECIPIENT_NAME }],
      },
      ...extra,
    })
  }

  function shareRow(): HTMLElement {
    return screen.getByText(SHARE_RECIPIENT_NAME).closest('li')!
  }

  it('shows a loading hint, then that the account is not shared yet', async () => {
    serve({})
    renderView(ONE_ACCOUNT)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('This account is not shared yet.')).toBeInTheDocument()
    expect(
      screen.getByText('There are no other users you could share this account with.'),
    ).toBeInTheDocument()
  })

  it('invites a user with the chosen permission', async () => {
    const user = userEvent.setup()
    serveShares([], { [`POST ${SHARES_URL}`]: { status: 201, body: share() } })
    renderView(ONE_ACCOUNT)

    const invite = await screen.findByRole('button', { name: 'Invite' })
    expect(invite).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select a user' }))
    await user.click(
      within(screen.getByRole('list', { name: 'Select a user' })).getByRole('button', {
        name: SHARE_RECIPIENT_NAME,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Permission' }))
    await user.click(
      within(screen.getByRole('list', { name: 'Permission' })).getByRole('button', {
        name: 'Read and write',
      }),
    )
    await user.click(invite)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Invitation sent'))
    expect(bodyOf('POST', SHARES_URL)).toEqual({ user_id: RECIPIENT_ID, permission: 'write' })
  })

  it('toasts when the invitation fails', async () => {
    const user = userEvent.setup()
    serveShares([], { [`POST ${SHARES_URL}`]: { status: 500, body: {} } })
    renderView(ONE_ACCOUNT)

    await user.click(await screen.findByRole('button', { name: 'Select a user' }))
    await user.click(screen.getByRole('button', { name: SHARE_RECIPIENT_NAME }))
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('The invitation could not be sent'),
    )
  })

  it('labels a user without a display name by their id', async () => {
    const user = userEvent.setup()
    serve({
      [`GET ${SHARES_URL}`]: { status: 200, body: [] },
      'GET /api/account_shares/users': { status: 200, body: [{ id: 8, display_name: '  ' }] },
    })
    renderView(ONE_ACCOUNT)

    await user.click(await screen.findByRole('button', { name: 'Select a user' }))

    expect(
      within(screen.getByRole('list', { name: 'Select a user' })).getByRole('button', {
        name: '#8',
      }),
    ).toBeInTheDocument()
  })

  it('lists a pending share and no longer offers its recipient', async () => {
    serveShares([share({ status: 'pending' })])
    renderView(ONE_ACCOUNT)

    expect(await screen.findByText(SHARE_RECIPIENT_NAME)).toBeInTheDocument()
    expect(within(shareRow()).getByText('Waiting for a response')).toBeInTheDocument()
    expect(
      screen.getByText('There are no other users you could share this account with.'),
    ).toBeInTheDocument()
  })

  it.each([
    [200, 'Saved', 'success'],
    [500, SAVE_FAILED, 'error'],
  ] as const)('changes the permission of a share (HTTP %i)', async (status, message, kind) => {
    const user = userEvent.setup()
    serveShares([share()], { 'PATCH /api/account_shares/5': { status, body: {} } })
    renderView(ONE_ACCOUNT)

    await screen.findByText(SHARE_RECIPIENT_NAME)
    await user.click(within(shareRow()).getByRole('button', { name: 'Permission' }))
    await user.click(screen.getByRole('button', { name: 'Read and write' }))

    await waitFor(() => expect(toastMock[kind]).toHaveBeenCalledWith(message))
    expect(bodyOf('PATCH', '/api/account_shares/5')).toEqual({ permission: 'write' })
  })

  it.each([
    [204, 'Share revoked', 'success'],
    [500, 'The share could not be revoked', 'error'],
  ] as const)('revokes a share after confirmation (HTTP %i)', async (status, message, kind) => {
    const user = userEvent.setup()
    serveShares([share()], { 'DELETE /api/account_shares/5': { status } })
    renderView(ONE_ACCOUNT)

    await screen.findByText(SHARE_RECIPIENT_NAME)
    await user.click(within(shareRow()).getByRole('button', { name: 'Delete' }))
    await user.click(within(shareRow()).getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(toastMock[kind]).toHaveBeenCalledWith(message))
    expect(requestsTo('DELETE', '/api/account_shares/5')).toHaveLength(1)
  })
})

describe('CredentialDetailView — an account shared with me', () => {
  const MINE_URL = '/api/account_shares/account/1/mine'

  function shared(overrides: Partial<CredentialRead> = {}): Partial<CredentialRead> {
    return {
      shared_from: SHARE_OWNER_NAME,
      share_permission: 'write',
      accounts: [account({ name: ACCOUNT_NAME_GIRO })],
      ...overrides,
    }
  }

  it('shows who shared it and hides the owner-only controls', () => {
    renderView(shared(), { onSyncClick: vi.fn() })

    expect(
      screen.getByText(
        `${SHARE_OWNER_NAME} shared this account with you with read and write access.`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync bank connection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete connection' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Include when syncing all accounts' }),
    ).not.toBeInTheDocument()
  })

  it('assumes read access when the permission is unknown', () => {
    renderView(shared({ share_permission: null }))
    expect(
      screen.getByText(`${SHARE_OWNER_NAME} shared this account with you with read access.`),
    ).toBeInTheDocument()
  })

  it('saves my own settings for the shared account through the share endpoint', async () => {
    const user = userEvent.setup()
    serve({ [`PATCH ${MINE_URL}`]: { status: 200, body: account() } })
    renderView(shared())
    expect(screen.queryByText('Archived')).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: 'Archive' }))

    expect(screen.getByText('Archived')).toBeInTheDocument()
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Saved'))
    expect(bodyOf('PATCH', MINE_URL)).toEqual({ is_archived: true })
  })

  it.each([
    [204, 'Share left', 'success'],
    [500, 'The share could not be left', 'error'],
  ] as const)('leaves the share after confirmation (HTTP %i)', async (status, message, kind) => {
    const user = userEvent.setup()
    serve({ [`DELETE ${MINE_URL}`]: { status } })
    renderView(shared())

    await user.click(screen.getByRole('button', { name: 'Leave the share' }))
    await user.click(screen.getByRole('button', { name: 'Really leave?' }))

    await waitFor(() => expect(toastMock[kind]).toHaveBeenCalledWith(message))
    expect(requestsTo('DELETE', MINE_URL)).toHaveLength(1)
  })
})

describe('/settings/credentials/$credentialId route', () => {
  const Page = Route.options.component!
  const tradeRepublic = credential({ bank: 'trade_republic' })

  type CredentialSync = ReturnType<typeof useCredentialSync>

  function syncState(overrides: Partial<CredentialSync> = {}): CredentialSync {
    return { start: vi.fn(), busy: false, succeededAt: null, ...overrides }
  }

  function mockHooks(user: UserRead | undefined, sync = syncState()) {
    vi.mocked(useAuthMe).mockReturnValue({ data: user } as ReturnType<typeof useAuthMe>)
    vi.mocked(useCredentialSync).mockReturnValue(sync)
    return sync
  }

  beforeEach(() => {
    routeState.params = { credentialId: '42' }
  })

  it('renders nothing until the user is loaded', () => {
    mockHooks(undefined)
    const { container } = renderWithQuery(<Page />)
    expect(container).toBeEmptyDOMElement()
    expect(useCredentialSync).toHaveBeenCalledWith(42)
  })

  it('shows the credential from the route and starts its sync', async () => {
    const sync = mockHooks(buildUser({ credentials: [tradeRepublic] }))
    renderWithQuery(<Page />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Trade Republic')
    await userEvent.click(screen.getByRole('button', { name: 'Sync bank connection' }))
    expect(sync.start).toHaveBeenCalledOnce()
  })

  it('disables the sync button while its bank syncs', () => {
    mockHooks(buildUser({ credentials: [tradeRepublic] }), syncState({ busy: true }))
    renderWithQuery(<Page />)
    expect(screen.getByRole('button', { name: 'Sync bank connection' })).toBeDisabled()
  })

  it('shows the not-found page without redirecting for an unknown id', () => {
    mockHooks(buildUser({ credentials: [] }))
    renderWithQuery(<Page />)
    expect(screen.getByText('The connection you seek, this is not.')).toBeInTheDocument()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('returns to the list once the credential disappears', () => {
    mockHooks(buildUser({ credentials: [tradeRepublic] }))
    const { rerender } = renderWithQuery(<Page />)
    expect(routerReplace).not.toHaveBeenCalled()

    mockHooks(buildUser({ credentials: [] }))
    rerender(<Page />)

    expect(routerReplace).toHaveBeenCalledWith('/settings/credentials')
  })

  it('returns to the list after deleting the connection', async () => {
    const user = userEvent.setup()
    serve({ [`DELETE ${CREDENTIAL_URL}`]: { status: 204 } })
    mockHooks(buildUser({ credentials: [tradeRepublic] }))
    renderWithQuery(<Page />)

    await user.click(screen.getByRole('button', { name: 'Delete connection' }))
    await user.click(screen.getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/settings/credentials'))
  })
})
