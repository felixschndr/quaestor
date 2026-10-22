import type { ReactNode } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { Current2FA, CredentialRead, UseAppSyncResult, UserRead } from '@/lib/auth'
import type { SyncJob } from '@/lib/credentials'
import { makeJob } from '@/test/syncTestHelpers'
import { buildUser } from '@/routes/__tests__/-settingsUserTestHelpers'

const mocks = vi.hoisted(() => ({
  user: undefined as UserRead | undefined,
  sync: null as unknown as UseAppSyncResult,
  push: vi.fn(),
}))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks({
    useRouter: () => ({ history: { push: mocks.push } }),
  }),
)
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuthMe: () => ({ data: mocks.user }),
  useAppSync: () => mocks.sync,
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(() => 'toast-id'), dismiss: vi.fn() }),
}))

import { toast } from 'sonner'

import { SyncProvider, useSync } from '@/components/sync-provider'

const BANK_TITLE = 'Trade Republic'

const start = vi.fn()
const submit2fa = vi.fn()
const skip2fa = vi.fn()

function credential(id: number, overrides: Partial<CredentialRead> = {}): CredentialRead {
  return {
    id,
    bank: 'trade_republic',
    bank_name: null,
    bank_icon: null,
    accounts: [],
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
    ...overrides,
  }
}

function setSync(overrides: Partial<UseAppSyncResult> = {}) {
  mocks.sync = {
    start,
    status: 'idle',
    jobs: new Map(),
    current2fa: null,
    submit2fa,
    skip2fa,
    succeededAt: null,
    failedAt: null,
    startError: null,
    ...overrides,
  }
}

function jobsOf(...jobs: SyncJob[]): Map<number, SyncJob> {
  return new Map(jobs.map((job) => [job.credential_id, job]))
}

function failed(credentialId: number, errorCode: SyncJob['error_code'] = 'timeout'): SyncJob {
  return makeJob({ credential_id: credentialId, status: 'failed', error_code: errorCode })
}

function Consumer() {
  const sync = useSync()
  return (
    <button type="button" onClick={() => sync.start()}>
      Sync now ({sync.status})
    </button>
  )
}

function ui(): ReactNode {
  return (
    <SyncProvider>
      <Consumer />
    </SyncProvider>
  )
}

const twoFactor: Current2FA = {
  credentialId: 1,
  jobId: 'job-1',
  bank: 'trade_republic',
  bankName: null,
  bankIcon: null,
  kind: 'awaiting_2fa',
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  mocks.user = buildUser({ credentials: [credential(1)] })
  setSync()
})

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  vi.clearAllMocks()
})

describe('useSync', () => {
  it('refuses to work outside of <SyncProvider>', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useSync())).toThrow('useSync must be used within <SyncProvider>')
  })

  it('hands the sync state to children and starts a full sync for them', async () => {
    setSync({ status: 'running' })
    render(ui())
    start.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Sync now (running)' }))

    expect(start).toHaveBeenCalledExactlyOnceWith(undefined)
  })
})

describe('SyncProvider auto-sync', () => {
  it('waits for the user, then syncs only the banks that are due', () => {
    mocks.user = undefined
    const { rerender } = render(ui())
    expect(start).not.toHaveBeenCalled()

    mocks.user = buildUser()
    rerender(ui())

    expect(start).toHaveBeenCalledExactlyOnceWith({ dueOnly: true })
  })

  it('syncs the due banks again whenever the tab comes back into view', () => {
    render(ui())
    start.mockClear()

    act(() => setVisibility('hidden'))
    expect(start).not.toHaveBeenCalled()

    act(() => setVisibility('visible'))
    expect(start).toHaveBeenCalledExactlyOnceWith({ dueOnly: true })
  })

  it('stops listening for the tab once unmounted', () => {
    const { unmount } = render(ui())
    unmount()
    start.mockClear()

    act(() => setVisibility('visible'))

    expect(start).not.toHaveBeenCalled()
  })
})

describe('SyncProvider failure toasts', () => {
  it('toasts each failed bank once, however often the jobs update', () => {
    const { rerender } = render(ui())

    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledOnce()
    render(vi.mocked(toast.error).mock.calls[0][0] as ReactNode)
    expect(screen.getByText(`${BANK_TITLE} couldn't be synced.`)).toBeInTheDocument()
  })

  it('stays quiet about banks the user cancelled', () => {
    const { rerender } = render(ui())

    setSync({ status: 'done', jobs: jobsOf(failed(1, 'cancelled')) })
    rerender(ui())

    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the credential from the toast and retries a full sync from its action', async () => {
    const { rerender } = render(ui())
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())
    start.mockClear()

    const [body, options] = vi.mocked(toast.error).mock.calls[0] as unknown as [
      ReactNode,
      { action: { onClick: () => void } },
    ]
    render(body)
    await userEvent.click(screen.getByRole('button', { name: /couldn't be synced/ }))
    act(() => options.action.onClick())

    expect(mocks.push).toHaveBeenCalledWith('/settings/credentials/1')
    expect(start).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('reports a failed job even before the user list knows its bank', async () => {
    mocks.user = undefined
    const { rerender } = render(ui())

    setSync({ status: 'done', jobs: jobsOf(failed(9)) })
    rerender(ui())

    render(vi.mocked(toast.error).mock.calls[0][0] as ReactNode)
    await userEvent.click(screen.getByRole('button', { name: /couldn't be synced/ }))
    expect(mocks.push).toHaveBeenCalledWith('/settings/credentials/9')
  })

  it('does not repeat a known bank error on an unattended sync, but reports new ones', async () => {
    mocks.user = buildUser({
      credentials: [credential(1, { last_sync_error_code: 'timeout' }), credential(2)],
    })
    const { rerender } = render(ui())

    setSync({ status: 'done', jobs: jobsOf(failed(1), failed(2)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledOnce()
    render(vi.mocked(toast.error).mock.calls[0][0] as ReactNode)
    await userEvent.click(screen.getByRole('button', { name: /couldn't be synced/ }))
    expect(mocks.push).toHaveBeenCalledWith('/settings/credentials/2')
  })

  it('reports a known bank error again when the user started the sync', async () => {
    mocks.user = buildUser({ credentials: [credential(1, { last_sync_error_code: 'timeout' })] })
    const { rerender } = render(ui())
    await userEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('toasts the same bank again once a new sync starts', () => {
    const { rerender } = render(ui())
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    setSync({ status: 'starting' })
    rerender(ui())
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledTimes(2)
  })
})

describe('SyncProvider two-factor dialog', () => {
  it('passes the entered code on to the running sync', async () => {
    submit2fa.mockResolvedValue(undefined)
    setSync({ status: 'awaiting_2fa', current2fa: twoFactor })
    render(ui())

    await userEvent.type(screen.getByLabelText('Code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(submit2fa).toHaveBeenCalledExactlyOnceWith('123456')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts a failure naming the bank when the code is not accepted', async () => {
    submit2fa.mockRejectedValue(new Error('rejected'))
    setSync({
      status: 'awaiting_2fa',
      current2fa: { ...twoFactor, bank: 'fints', bankName: 'DKB' },
    })
    render(ui())

    await userEvent.type(screen.getByLabelText('Code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("DKB couldn't be synced.")
  })

  it('skips the bank and says so when the dialog is closed', async () => {
    setSync({ status: 'awaiting_2fa', current2fa: twoFactor })
    render(ui())

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(skip2fa).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledExactlyOnceWith(`${BANK_TITLE} skipped.`)
  })

  it('skips silently when the bank is not known', async () => {
    setSync({ status: 'awaiting_2fa', current2fa: { ...twoFactor, bank: '' } })
    render(ui())

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(skip2fa).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })
})
