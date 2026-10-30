import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { toast } from 'sonner'

import '@/i18n'

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () =>
  (await import('./-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: routerPush } }),
  }),
)

import { NewCredentialFormView } from '@/pages/settings.credentials.new.$bank'
import { Route } from '@/routes/settings.credentials.new.$bank'
import { NO_CODE_PLACEHOLDER } from '@/lib/credentials'
import type { SupportedBank, SyncJob } from '@/lib/credentials'
import { authQueryKeys } from '@/lib/auth'
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
import { openPopoverOptions, selectFromPopover } from '@/test/popover-select'
import {
  AUTHORIZATION_URL,
  AUTHORIZATION_URL_WITH_CODE,
  DATETIME_FAR_FUTURE,
  DEVICE_CODE,
  TWO_FACTOR_CODE,
} from '@/test/constants'

const ING_BANK: SupportedBank = {
  provider: 'ing',
  key: 'ing',
  name: 'ING',
  bic: null,
  icon: '/static/banks/ing-diba.png',
  tested: true,
  required_fields: ['username', 'password'],
  blzs: ['50010517'],
}

const DFS_BANK: SupportedBank = {
  provider: 'dfs',
  key: 'dfs',
  name: 'Deutsche Finance Service',
  bic: null,
  icon: '/static/banks/dfs.png',
  tested: false,
  required_fields: ['username', 'password'],
  blzs: [],
}

const TR_BANK: SupportedBank = {
  provider: 'trade_republic',
  key: 'trade_republic',
  name: 'Trade Republic',
  bic: null,
  icon: '/static/banks/trade-republic.png',
  tested: true,
  required_fields: ['phone', 'pin'],
  blzs: [],
  field_rules: {
    phone: {
      strip_whitespace: true,
      rules: [
        {
          name: 'phone_country_code',
          regex: '^\\+',
          description: 'start with a country code (e.g. +49)',
        },
      ],
    },
    pin: {
      strip_whitespace: false,
      rules: [{ name: 'pin_four_digits', regex: '^\\d{4}$', description: 'be exactly 4 digits' }],
    },
  },
}

// Device-code/OAuth login: no credential fields, no code ever comes back from the provider.
const SCALABLE_CAPITAL_BANK: SupportedBank = {
  provider: 'scalable_capital',
  key: 'scalable_capital',
  name: 'Scalable Capital',
  bic: null,
  icon: '/static/banks/scalable-capital.png',
  tested: true,
  required_fields: [],
  blzs: [],
}

// A grouped FinTS bank with a single branch BLZ: only login + PIN, BLZ injected on submit.
const SPARKASSE_BANK: SupportedBank = {
  provider: 'fints',
  key: '66050101',
  name: 'Sparkasse Pforzheim Calw',
  bic: null,
  icon: '/static/banks/sparkasse.png',
  tested: true,
  required_fields: ['username', 'password'],
  blzs: ['66050101'],
}

// A grouped FinTS bank with several branch BLZs: the form asks for an IBAN to disambiguate.
const DEUTSCHE_BANK: SupportedBank = {
  provider: 'fints',
  key: '10070000',
  name: 'Deutsche Bank',
  bic: null,
  icon: null,
  tested: false,
  required_fields: ['username', 'password'],
  blzs: ['10070000', '12070000'],
}

const MANUAL_BANK: SupportedBank = {
  provider: 'manual',
  key: 'manual',
  name: 'Manual account',
  bic: null,
  icon: '/static/banks/manual.png',
  tested: true,
  required_fields: [],
  blzs: [],
}

const NORDEA_BANK: SupportedBank = {
  provider: 'enable_banking',
  key: 'eb-FI-Nordea',
  name: 'Nordea',
  bic: null,
  icon: null,
  tested: true,
  required_fields: ['private_key'],
  blzs: [],
  countries: ['FI'],
}

const PAYPAL_BANK: SupportedBank = {
  ...NORDEA_BANK,
  key: 'eb-PayPal',
  name: 'PayPal',
  countries: ['DE', 'FR'],
}

const PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg\n-----END PRIVATE KEY-----\n'
const KEY_FILE_NAME = 'quaestor.pem'
const CONFIRM_URL = '/api/credentials/30/sync/job-1/2fa'

type FormProps = Partial<Parameters<typeof NewCredentialFormView>[0]>
type User = ReturnType<typeof userEvent.setup>

let polledJob: SyncJob | null = null

function pollBranch(url: string, init?: { method?: string }): Promise<Response> | null {
  if ((init?.method ?? 'GET') === 'GET' && /\/sync\/[^/?]+$/.test(url)) {
    return Promise.resolve(jsonResponse({ status: polledJob ? 200 : 404, body: polledJob }))
  }
  return null
}

async function waitForFirstPoll(): Promise<void> {
  await waitFor(() =>
    expect(
      (globalThis.fetch as Mock).mock.calls.some(
        ([u, i]) =>
          typeof u === 'string' && /\/sync\/[^/?]+$/.test(u) && (i?.method ?? 'GET') === 'GET',
      ),
    ).toBe(true),
  )
}

async function pushJob(message: Partial<SyncJob> & Pick<SyncJob, 'status'>): Promise<void> {
  polledJob = {
    job_id: 'job-1',
    credential_id: 30,
    expires_at: null,
    error: null,
    error_code: null,
    ...message,
  }
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function createdCredential(id: number, bank: string) {
  return {
    status: 201,
    body: {
      id,
      bank,
      bank_name: null,
      bank_icon: null,
      accounts: [],
      last_successful_sync_timestamp: null,
      requires_two_factor_authentication: false,
      sync_enabled: true,
    },
  }
}

const STARTED_JOB = {
  status: 202,
  body: {
    job_id: 'job-1',
    credential_id: 30,
    status: 'running',
    expires_at: null,
    error: null,
  },
}

function serveSyncedCreate(extra: Served = {}) {
  return serve(
    {
      'POST /api/credentials': createdCredential(30, 'ing'),
      'POST /api/credentials/30/sync': STARTED_JOB,
      'DELETE /api/credentials/30': { status: 204 },
      ...extra,
    },
    pollBranch,
  )
}

function renderForm(bank: SupportedBank, props: FormProps = {}, client?: QueryClient) {
  return renderWithQuery(
    <NewCredentialFormView
      bankKey={bank.key}
      bank={bank}
      isLoading={false}
      onCancel={vi.fn()}
      onConnected={vi.fn()}
      onSyncFailed={vi.fn()}
      {...props}
    />,
    client,
  )
}

async function submitLogin(user: User) {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'hunter2')
  await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
}

async function submitTradeRepublic(user: User, phone = '+491234567890') {
  await user.type(screen.getByLabelText('Phone number'), phone)
  await user.type(screen.getByLabelText('PIN'), '1234')
  await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
}

async function uploadKey(user: User) {
  await user.upload(
    screen.getByLabelText('Private key (.pem)'),
    new File([PRIVATE_KEY_PEM], KEY_FILE_NAME, { type: 'application/x-pem-file' }),
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  polledJob = null
  document.cookie = ''
})

describe('NewCredentialFormView', () => {
  it('renders one input per required_field with the localised label', () => {
    renderForm(ING_BANK)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connect ING')
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText('Customer number')).not.toBeInTheDocument()
  })

  it('renders the loading state while the supported_banks query is in flight', () => {
    renderForm(ING_BANK, { bank: undefined, isLoading: true })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an unknown-bank fallback with a back button when the URL points to a non-existent bank', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderForm(ING_BANK, { bankKey: 'not-a-real-bank', bank: undefined, onCancel })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('asks for the country when an Enable Banking institution exists in several countries', () => {
    renderForm(PAYPAL_BANK)
    expect(screen.getByLabelText('Country')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeDisabled()
  })

  it('does not ask for the country when the institution exists in a single country', () => {
    renderForm(NORDEA_BANK)
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument()
  })

  it('creates the credential, starts the sync, and routes to onConnected when the WS reports completed', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderForm(ING_BANK, { onConnected, onSyncFailed })
    await submitLogin(user)

    await waitForFirstPoll()
    await pushJob({ status: 'completed' })

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(onSyncFailed).not.toHaveBeenCalled()
  })

  it('creates a manual credential without starting a sync', async () => {
    const user = userEvent.setup()
    const fetchMock = serve({ 'POST /api/credentials': createdCredential(7, 'manual') })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderForm(MANUAL_BANK, { onConnected, onSyncFailed })
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(7))
    expect(onSyncFailed).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/sync'))).toBe(false)
  })

  it('deletes the credential when the user abandons the setup while the job is pending', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()

    const { unmount } = renderForm(ING_BANK)
    await submitLogin(user)

    await waitForFirstPoll()
    await pushJob({ status: 'awaiting_2fa' })
    await screen.findByLabelText('Code')

    unmount()
    await waitFor(() => expect(requestsTo('DELETE', '/api/credentials/30')).toHaveLength(1))
  })

  it('bounces back to onSyncFailed when the WS reports failed', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderForm(ING_BANK, { onConnected, onSyncFailed })
    await submitLogin(user)

    await waitForFirstPoll()
    await pushJob({ status: 'failed', error: 'bank unreachable' })

    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
    expect(onConnected).not.toHaveBeenCalled()
    // A generic (non-credential) failure is transient — the credential is kept so the user can retry.
    expect(requestsTo('DELETE', '/api/credentials/30')).toHaveLength(0)
  })

  it('shows a dedicated message when the WS reports failed with invalid_credentials', async () => {
    const user = userEvent.setup()
    const toastError = vi.spyOn(toast, 'error')
    serveSyncedCreate()
    const onSyncFailed = vi.fn()

    renderForm(ING_BANK, { onSyncFailed })
    await submitLogin(user)

    await waitForFirstPoll()
    await pushJob({
      status: 'failed',
      error: 'The bank rejected the login',
      error_code: 'invalid_credentials',
    })

    await waitFor(() => expect(requestsTo('DELETE', '/api/credentials/30')).toHaveLength(1))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toMatch(/check your username and password/i)
    expect(onSyncFailed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect and sync' })).toBeEnabled()
  })

  it('bounces back to onSyncFailed when starting the sync itself errors', async () => {
    const user = userEvent.setup()
    serveSyncedCreate({
      'POST /api/credentials/30/sync': { status: 500, body: { detail: 'Internal' } },
    })
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderForm(ING_BANK, { onConnected, onSyncFailed })
    await submitLogin(user)

    await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('surfaces a dedicated toast and stays on the form when the backend returns 409', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const user = userEvent.setup()
    const fetchMock = serve(
      {
        'POST /api/credentials': {
          status: 409,
          body: { detail: 'User 1 already has an ing credential with the same login data' },
        },
      },
      pollBranch,
    )
    const onConnected = vi.fn()
    const onSyncFailed = vi.fn()

    renderForm(ING_BANK, { onConnected, onSyncFailed })
    await submitLogin(user)

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0][0]).toMatch(/already exists/i)
    expect(onConnected).not.toHaveBeenCalled()
    expect(onSyncFailed).not.toHaveBeenCalled()
    // No sync was started — the form is the only POST we made.
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(1)
  })

  it('blocks submission with an inline required-field error when a field is empty', async () => {
    const user = userEvent.setup()
    const onConnected = vi.fn()

    renderForm(ING_BANK, { onConnected })
    await user.type(screen.getByLabelText('Username'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('blocks submission with a field error when the Trade Republic phone has no country code', async () => {
    const user = userEvent.setup()
    renderForm(TR_BANK)
    await submitTradeRepublic(user, '491512345')

    // The field-level error (distinct from the bank note that also mentions "country code").
    expect(await screen.findByText(/must start with a country code/i)).toBeInTheDocument()
    // Client-side validation (from the backend rules) blocks the request entirely.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('strips whitespace from the Trade Republic phone before submitting', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()

    renderForm(TR_BANK)
    await submitTradeRepublic(user, '+49 151 23')

    await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
    // The phone is de-spaced; the PIN (not a stripped field) is sent verbatim.
    expect(bodyOf('POST', '/api/credentials')).toEqual({
      bank: 'trade_republic',
      credentials: { phone: '+4915123', pin: '1234' },
    })
  })

  it('renders the bank-specific note from i18n when one exists', () => {
    renderForm(DFS_BANK)
    expect(
      screen.getByText(/Retirement provisioning of the Deutsche Flugsicherung GmbH\./),
    ).toBeInTheDocument()
  })

  describe('Trade Republic 2FA flow', () => {
    it('hides the code field until the WS reports awaiting_2fa', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: STARTED_JOB })

      renderForm(TR_BANK)

      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()

      await submitTradeRepublic(user)

      await waitForFirstPoll()

      await pushJob({ status: 'running' })
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()

      await pushJob({ status: 'awaiting_2fa', expires_at: DATETIME_FAR_FUTURE })

      expect(await screen.findByLabelText('Code')).toBeInTheDocument()
      expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
    })

    it('confirms the code and routes to onConnected after the WS pushes completed', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: STARTED_JOB })
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderForm(TR_BANK, { onConnected, onSyncFailed })
      await submitTradeRepublic(user)

      await waitForFirstPoll()
      await pushJob({ status: 'awaiting_2fa', expires_at: DATETIME_FAR_FUTURE })

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, '4242')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await pushJob({ status: 'completed' })

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()
      expect(bodyOf('POST', CONFIRM_URL)).toEqual({ code: '4242' })
    })

    it('bounces back to onSyncFailed when submitting the code errors', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: { status: 422, body: { detail: 'expired' } } })
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderForm(TR_BANK, { onConnected, onSyncFailed })
      await submitTradeRepublic(user)

      await waitForFirstPoll()
      await pushJob({ status: 'awaiting_2fa', expires_at: DATETIME_FAR_FUTURE })

      const codeInput = await screen.findByLabelText('Code')
      await user.type(codeInput, 'wrong')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
      expect(onConnected).not.toHaveBeenCalled()
    })
  })

  describe('Scalable Capital no-code 2FA flow', () => {
    async function startLogin(user: User, props: FormProps = {}) {
      renderForm(SCALABLE_CAPITAL_BANK, props)
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
      await waitForFirstPoll()
      await pushJob({
        status: 'awaiting_2fa',
        expires_at: DATETIME_FAR_FUTURE,
        authorization_url: AUTHORIZATION_URL_WITH_CODE,
      })
    }

    it('shows an authorize link and a no-code confirm button instead of a code field', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: STARTED_JOB })

      await startLogin(user)

      expect(
        await screen.findByRole('link', { name: /sign in at scalable capital/i }),
      ).toHaveAttribute('href', AUTHORIZATION_URL_WITH_CODE)
      expect(screen.getByText(DEVICE_CODE)).toBeVisible()
      expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: "I've completed the login" })).toBeInTheDocument()
    })

    it('confirms without a code and routes to onConnected after the WS pushes completed', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: STARTED_JOB })
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      await startLogin(user, { onConnected, onSyncFailed })
      await user.click(screen.getByRole('button', { name: "I've completed the login" }))

      await pushJob({ status: 'completed' })

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()
      expect(bodyOf('POST', CONFIRM_URL)).toEqual({ code: NO_CODE_PLACEHOLDER })
    })

    it('shows a waiting message instead of the connect form while confirming_2fa is in progress', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: STARTED_JOB })

      await startLogin(user)
      await user.click(screen.getByRole('button', { name: "I've completed the login" }))

      // confirming_2fa spans the whole first sync — must show a waiting state, not the form again.
      await pushJob({ status: 'confirming_2fa' })

      expect(await screen.findByText(/Finishing up/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Connect and sync' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: "I've completed the login" }),
      ).not.toBeInTheDocument()
    })

    it('bounces back to onSyncFailed when the no-code confirmation errors', async () => {
      const user = userEvent.setup()
      serveSyncedCreate({ [`POST ${CONFIRM_URL}`]: { status: 422, body: {} } })
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      await startLogin(user, { onConnected, onSyncFailed })
      await user.click(screen.getByRole('button', { name: "I've completed the login" }))

      await waitFor(() => expect(onSyncFailed).toHaveBeenCalledTimes(1))
      expect(onConnected).not.toHaveBeenCalled()
    })
  })

  describe('Sparkasse decoupled approval flow', () => {
    it('shows the approval message when the sync reports awaiting_decoupled_approval', async () => {
      const user = userEvent.setup()
      serveSyncedCreate()

      renderForm(SPARKASSE_BANK)
      await submitLogin(user)

      await waitForFirstPoll()
      await pushJob({ status: 'awaiting_decoupled_approval' })

      expect(await screen.findByText(/Please approve in your banking app/)).toBeInTheDocument()
      // The form is replaced by the waiting panel.
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    })

    it('completes the sync after the approval transitions to running and then completed', async () => {
      const user = userEvent.setup()
      serveSyncedCreate()
      const onConnected = vi.fn()
      const onSyncFailed = vi.fn()

      renderForm(SPARKASSE_BANK, { onConnected, onSyncFailed })
      await submitLogin(user)

      await waitForFirstPoll()
      await pushJob({ status: 'awaiting_decoupled_approval' })
      expect(await screen.findByText(/Please approve in your banking app/)).toBeInTheDocument()

      await pushJob({ status: 'running' })
      await pushJob({ status: 'completed' })

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
      expect(onSyncFailed).not.toHaveBeenCalled()
    })
  })

  describe('grouped FinTS banks', () => {
    it('submits a single-blz fints bank with the prefilled blz and no iban field', async () => {
      const user = userEvent.setup()
      serveSyncedCreate()

      renderForm(SPARKASSE_BANK)

      // A single-BLZ FinTS bank only asks for login + PIN; the BLZ is injected.
      expect(screen.queryByLabelText('IBAN')).not.toBeInTheDocument()
      await submitLogin(user)

      await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
      expect(bodyOf('POST', '/api/credentials')).toEqual({
        bank: 'fints',
        credentials: { username: 'alice', password: 'hunter2', blz: '66050101' },
      })
    })

    it('asks for an IBAN on a multi-blz bank and derives the matching blz', async () => {
      const user = userEvent.setup()
      serveSyncedCreate()

      renderForm(DEUTSCHE_BANK)

      await user.type(screen.getByLabelText('Username'), 'bob')
      await user.type(screen.getByLabelText('Password'), 'hunter2')
      // IBAN whose BLZ (chars 5-12) is 12070000 — a branch BLZ of this bank.
      await user.type(screen.getByLabelText('IBAN'), 'DE89120700000532013000')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
      // The IBAN itself is never sent to the backend.
      expect(bodyOf('POST', '/api/credentials')).toEqual({
        bank: 'fints',
        credentials: { username: 'bob', password: 'hunter2', blz: '12070000' },
      })
    })

    it('rejects an IBAN whose blz does not belong to the bank and sends nothing', async () => {
      const user = userEvent.setup()

      renderForm(DEUTSCHE_BANK)

      await user.type(screen.getByLabelText('Username'), 'bob')
      await user.type(screen.getByLabelText('Password'), 'hunter2')
      // BLZ 50010517 is not one of this bank's branch BLZs.
      await user.type(screen.getByLabelText('IBAN'), 'DE89500105170532013000')
      await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

      expect(
        await screen.findByText(/This IBAN does not belong to the selected bank/i),
      ).toBeInTheDocument()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })
})

describe('NewCredentialFormView — Enable Banking', () => {
  const redirectUrl = () => `${window.location.origin}/banking/callback`

  it('guides through the app setup and warns that plain HTTP will not work', () => {
    renderForm(NORDEA_BANK)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Connect Nordea via Enable Banking',
    )
    expect(
      screen.getByRole('heading', { name: 'One-time Enable Banking setup' }),
    ).toBeInTheDocument()
    expect(screen.getByText(redirectUrl())).toBeInTheDocument()
    expect(
      screen.getByText(/Enable Banking requires Quaestor to be served over HTTPS/),
    ).toBeInTheDocument()
  })

  it('requires the key file before connecting', async () => {
    const user = userEvent.setup()
    renderForm(NORDEA_BANK)

    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    expect(await screen.findByText('This field is required')).toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uploads the key and sends it with the institution, country and redirect URL', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    renderForm(NORDEA_BANK)

    await uploadKey(user)
    expect(await screen.findByText('Key loaded ✓')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
    expect(bodyOf('POST', '/api/credentials')).toEqual({
      bank: 'enable_banking',
      credentials: {
        private_key: PRIVATE_KEY_PEM,
        private_key_file_name: KEY_FILE_NAME,
        aspsp_name: 'Nordea',
        aspsp_country: 'FI',
        redirect_url: redirectUrl(),
      },
    })
  })

  it('sends the picked country when the institution exists in several', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    renderForm(PAYPAL_BANK)

    expect(await openPopoverOptions(user, 'Country')).toEqual(['France', 'Germany'])
    await user.click(screen.getByRole('button', { name: 'Germany' }))
    await uploadKey(user)
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
    expect(bodyOf('POST', '/api/credentials')).toMatchObject({
      credentials: { aspsp_name: 'PayPal', aspsp_country: 'DE' },
    })
  })

  it('reuses an existing Enable Banking app instead of asking for a key again', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(
      authQueryKeys.me,
      buildUser({
        credentials: [
          {
            id: 1,
            bank: 'enable_banking',
            bank_name: 'Nordea',
            bank_icon: null,
            accounts: [],
            last_successful_sync_timestamp: null,
            requires_two_factor_authentication: false,
            sync_enabled: true,
          },
        ],
      }),
    )
    renderForm(PAYPAL_BANK, {}, queryClient)

    expect(
      screen.getByText(/Your existing Enable Banking application is reused/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'control panel' })).toHaveAttribute(
      'href',
      'https://enablebanking.com/cp/applications',
    )
    expect(screen.queryByLabelText('Private key (.pem)')).not.toBeInTheDocument()
    await selectFromPopover(user, 'Country', 'France')
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))

    await waitFor(() => expect(requestsTo('POST', '/api/credentials')).toHaveLength(1))
    expect(bodyOf('POST', '/api/credentials')).toEqual({
      bank: 'enable_banking',
      credentials: { aspsp_name: 'PayPal', aspsp_country: 'FR', redirect_url: redirectUrl() },
    })
  })

  it.each([
    [
      'redirect_url_not_allowed',
      (): string =>
        `Enable Banking does not allow the redirect URL ${redirectUrl()}. Whitelist it in your application in the control panel and connect again.`,
    ],
    [
      'application_not_activated',
      (): string =>
        'Your Enable Banking application is not active yet. Link your bank in the control panel (“Link accounts”) first, then connect again.',
    ],
  ] as const)('deletes the credential and explains a %s failure', async (errorCode, message) => {
    const user = userEvent.setup()
    const toastError = vi.spyOn(toast, 'error')
    const onSyncFailed = vi.fn()
    serveSyncedCreate()
    renderForm(NORDEA_BANK, { onSyncFailed })

    await uploadKey(user)
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
    await waitForFirstPoll()
    await pushJob({ status: 'failed', error_code: errorCode })

    await waitFor(() => expect(requestsTo('DELETE', '/api/credentials/30')).toHaveLength(1))
    expect(toastError).toHaveBeenCalledWith(message(), { duration: 12000 })
    expect(onSyncFailed).not.toHaveBeenCalled()
  })

  it('asks for the code shown after signing in at the bank', async () => {
    const user = userEvent.setup()
    serveSyncedCreate()
    renderForm(NORDEA_BANK)

    await uploadKey(user)
    await user.click(screen.getByRole('button', { name: 'Connect and sync' }))
    expect(await screen.findByRole('button', { name: 'Syncing…' })).toBeDisabled()
    await waitForFirstPoll()
    await pushJob({ status: 'awaiting_2fa', authorization_url: AUTHORIZATION_URL })

    expect(await screen.findByRole('link', { name: 'Sign in at Nordea' })).toHaveAttribute(
      'href',
      AUTHORIZATION_URL,
    )
    expect(
      screen.getByText(/Sign in at Nordea via the link and approve access/),
    ).toBeInTheDocument()
    const codeInput = screen.getByLabelText('Code')
    expect(codeInput).toHaveAttribute('inputmode', 'text')
    ;(globalThis.fetch as Mock).mockImplementation(
      (url: string, init?: RequestInit) => pollBranch(url, init) ?? new Promise(() => {}),
    )
    await user.type(codeInput, TWO_FACTOR_CODE)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('button', { name: 'Confirming …' })).toBeDisabled()
    expect(bodyOf('POST', CONFIRM_URL)).toEqual({ code: TWO_FACTOR_CODE })
  })
})

describe('NewCredentialFormView — create errors', () => {
  it('shows the server validation message next to the offending field', async () => {
    const user = userEvent.setup()
    const toastError = vi.spyOn(toast, 'error')
    serve(
      {
        'POST /api/credentials': {
          status: 422,
          body: {
            detail: [
              { loc: ['body', 'credentials', 'username'], msg: 'Unknown login' },
              { loc: ['body', 0], msg: 'not a field' },
              'garbage',
            ],
          },
        },
      },
      pollBranch,
    )
    renderForm(ING_BANK)

    await submitLogin(user)

    expect(await screen.findByText('Unknown login')).toBeInTheDocument()
    expect(screen.queryByText('not a field')).not.toBeInTheDocument()
    expect(toastError).not.toHaveBeenCalled()
  })

  it.each([
    [422, { detail: 'Bad request' }],
    [500, { detail: 'boom' }],
  ])('falls back to a generic toast for HTTP %i', async (status, body) => {
    const user = userEvent.setup()
    const toastError = vi.spyOn(toast, 'error')
    serve({ 'POST /api/credentials': { status, body } }, pollBranch)
    renderForm(ING_BANK)

    await submitLogin(user)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not connect to ING. Please check the credentials.',
      ),
    )
  })

  it('shows a busy label while the credential is being created', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(() => new Promise(() => {}))
    renderForm(ING_BANK)

    await submitLogin(user)

    expect(await screen.findByRole('button', { name: 'Connecting…' })).toBeDisabled()
  })
})

describe('/settings/credentials/new/$bank route', () => {
  const Page = Route.options.component!

  function serveBanks(extra: Served = {}) {
    serve(
      {
        'GET /api/credentials/supported_banks': { status: 200, body: [ING_BANK, MANUAL_BANK] },
        ...extra,
      },
      pollBranch,
    )
  }

  it('loads the bank catalog and opens the form for the bank in the URL', async () => {
    serveBanks()
    routeState.params = { bank: 'ing' }
    renderWithQuery(<Page />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connect ING')
  })

  it('goes back to the list from an unknown bank', async () => {
    serveBanks()
    routeState.params = { bank: 'no-such-bank' }
    renderWithQuery(<Page />)

    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(routerPush).toHaveBeenCalledWith('/settings/credentials')
  })

  it('opens the new manual credential to add its accounts', async () => {
    serveBanks({ 'POST /api/credentials': createdCredential(7, 'manual') })
    routeState.params = { bank: 'manual' }
    renderWithQuery(<Page />)

    await userEvent.click(await screen.findByRole('button', { name: 'Create' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/settings/credentials/7'))
  })

  it('lands on the overview once a synced bank is connected', async () => {
    const user = userEvent.setup()
    serveBanks({
      'POST /api/credentials': createdCredential(30, 'ing'),
      'POST /api/credentials/30/sync': STARTED_JOB,
    })
    routeState.params = { bank: 'ing' }
    renderWithQuery(<Page />)

    await screen.findByLabelText('Username')
    await submitLogin(user)
    await waitForFirstPoll()
    await pushJob({ status: 'completed' })

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/'))
  })

  it('returns to the list when the first sync cannot start', async () => {
    const user = userEvent.setup()
    vi.spyOn(toast, 'error')
    serveBanks({
      'POST /api/credentials': createdCredential(42, 'ing'),
      'POST /api/credentials/42/sync': { status: 500, body: {} },
    })
    routeState.params = { bank: 'ing' }
    renderWithQuery(<Page />)

    await screen.findByLabelText('Username')
    await submitLogin(user)

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/settings/credentials'))
  })
})
