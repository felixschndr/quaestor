import type { ReactNode } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'
import type { CredentialRead, UseAppSyncResult, UserRead } from '@/lib/auth'
import type { SyncJob } from '@/lib/credentials'
import { makeJob, twoFactor } from '@/test/syncTestHelpers'
import { buildUser } from '@/test/helpers'
import { buildCredential } from '@/test/statsFixtures'

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

import { ApiError } from '@/lib/api'
import { SyncProvider, useCredentialSync, useSync } from '@/components/sync-provider'

const BANK_TITLE = 'Trade Republic'

const start = vi.fn<UseAppSyncResult['start']>(() => Promise.resolve([]))
const adopt = vi.fn(() => Promise.resolve())
const credentialState = vi.fn<UseAppSyncResult['credential']>(() => ({
  busy: false,
  succeededAt: null,
}))
const submit2fa = vi.fn()
const skip2fa = vi.fn()

const credential = (id: number, overrides: Partial<CredentialRead> = {}) =>
  buildCredential([], { id, bank: 'trade_republic', ...overrides })

function setSync(overrides: Partial<UseAppSyncResult> = {}) {
  mocks.sync = {
    start,
    adopt,
    credential: credentialState,
    status: 'idle',
    jobs: new Map(),
    current2fa: null,
    submit2fa,
    skip2fa,
    succeededAt: null,
    failedAt: null,
    ...overrides,
  }
}

async function autoSyncStarted(...jobs: SyncJob[]) {
  start.mockResolvedValueOnce(jobs)
  const view = render(ui())
  await act(async () => {})
  return view
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
    expect(adopt).toHaveBeenCalledOnce()
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

  it('opens the credential from the toast and retries just that bank from its action', async () => {
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
    expect(start).toHaveBeenCalledExactlyOnceWith({ credentialId: 1 })
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
    const { rerender } = await autoSyncStarted(
      makeJob({ credential_id: 1 }),
      makeJob({ credential_id: 2 }),
    )

    setSync({ status: 'done', jobs: jobsOf(failed(1), failed(2)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledOnce()
    render(vi.mocked(toast.error).mock.calls[0][0] as ReactNode)
    await userEvent.click(screen.getByRole('button', { name: /couldn't be synced/ }))
    expect(mocks.push).toHaveBeenCalledWith('/settings/credentials/2')
  })

  it('reports a known bank error again when the user started the sync', async () => {
    mocks.user = buildUser({ credentials: [credential(1, { last_sync_error_code: 'timeout' })] })
    const { rerender } = await autoSyncStarted(makeJob({ credential_id: 1 }))
    await userEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('still reports a sync the user started when the tab comes back during it', async () => {
    mocks.user = buildUser({ credentials: [credential(1, { last_sync_error_code: 'timeout' })] })
    const { rerender } = render(ui())
    await userEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    await act(async () => setVisibility('visible'))
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    expect(start).toHaveBeenLastCalledWith({ dueOnly: true })
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('toasts the same bank again for a new sync job', () => {
    const { rerender } = render(ui())
    setSync({ status: 'done', jobs: jobsOf(failed(1)) })
    rerender(ui())

    setSync({ status: 'done', jobs: jobsOf({ ...failed(1), job_id: 'job-1-retry' }) })
    rerender(ui())

    expect(toast.error).toHaveBeenCalledTimes(2)
  })
})

describe('useCredentialSync', () => {
  function CredentialConsumer() {
    const sync = useCredentialSync(1)
    return (
      <button type="button" onClick={sync.start}>
        Sync bank ({sync.busy ? 'busy' : 'idle'})
      </button>
    )
  }

  function renderCredential() {
    render(
      <SyncProvider>
        <CredentialConsumer />
      </SyncProvider>,
    )
  }

  it('shows the state of its bank and syncs just that bank', async () => {
    credentialState.mockReturnValue({ busy: true, succeededAt: null })
    renderCredential()
    start.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Sync bank (busy)' }))

    expect(credentialState).toHaveBeenCalledWith(1)
    expect(start).toHaveBeenCalledExactlyOnceWith({ credentialId: 1 })
  })

  it('tells a share recipient that only the owner can sync', async () => {
    renderCredential()
    start.mockRejectedValueOnce(new ApiError(403, {}, 'forbidden'))

    await userEvent.click(screen.getByRole('button', { name: /Sync bank/ }))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Only its owner can refresh this account')
  })

  it('reports any other failed start for the bank', async () => {
    renderCredential()
    start.mockRejectedValueOnce(new ApiError(500, {}, 'boom'))

    await userEvent.click(screen.getByRole('button', { name: /Sync bank/ }))

    render(vi.mocked(toast.error).mock.calls[0][0] as ReactNode)
    expect(screen.getByText(`${BANK_TITLE} couldn't be synced.`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /couldn't be synced/ }))
    expect(mocks.push).toHaveBeenCalledWith('/settings/credentials/1')
  })

  it('stays quiet when a full sync could not be started', async () => {
    render(ui())
    start.mockRejectedValueOnce(new ApiError(500, {}, 'boom'))

    await userEvent.click(screen.getByRole('button', { name: /Sync now/ }))

    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('SyncProvider two-factor dialog', () => {
  it('passes the entered code on to the running sync', async () => {
    submit2fa.mockResolvedValue(undefined)
    setSync({ status: 'awaiting_2fa', current2fa: twoFactor() })
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
      current2fa: twoFactor({ bank: 'fints', bankName: 'DKB' }),
    })
    render(ui())

    await userEvent.type(screen.getByLabelText('Code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(toast.error).toHaveBeenCalledExactlyOnceWith("DKB couldn't be synced.")
  })

  it('skips the bank and says so when the dialog is closed', async () => {
    setSync({ status: 'awaiting_2fa', current2fa: twoFactor() })
    render(ui())

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(skip2fa).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledExactlyOnceWith(`${BANK_TITLE} skipped.`)
  })

  it('skips silently when the bank is not known', async () => {
    setSync({ status: 'awaiting_2fa', current2fa: twoFactor({ bank: '' }) })
    render(ui())

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(skip2fa).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })
})
