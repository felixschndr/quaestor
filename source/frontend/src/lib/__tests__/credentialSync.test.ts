import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useAppSync } from '@/lib/auth'
import { installSyncFetchMock, makeJob, wrapper } from '@/test/syncTestHelpers'
import { TWO_FACTOR_CODE } from '@/test/constants'

const CREDENTIAL_ID = 7
const OTHER_CREDENTIAL_ID = 8

const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))

describe('useAppSync for a single bank', () => {
  it('syncs only that bank and reports its success for it alone', async () => {
    const { fetchMock, setJob } = installSyncFetchMock([makeJob({ credential_id: CREDENTIAL_ID })])
    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(async () => {
      await result.current.start({ credentialId: CREDENTIAL_ID })
    })

    expect(posts(fetchMock)).toEqual([`/api/credentials/${CREDENTIAL_ID}/sync`])
    expect(result.current.credential(CREDENTIAL_ID)).toEqual({ busy: true, succeededAt: null })
    expect(result.current.credential(OTHER_CREDENTIAL_ID).busy).toBe(false)

    await setJob(makeJob({ credential_id: CREDENTIAL_ID, status: 'completed' }))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.credential(CREDENTIAL_ID)).toEqual({
      busy: false,
      succeededAt: expect.any(Number),
    })
    expect(result.current.credential(OTHER_CREDENTIAL_ID).succeededAt).toBeNull()
  })

  it('reports a failure that only shows up after the 2FA code was accepted', async () => {
    const { setJob } = installSyncFetchMock([makeJob({ credential_id: CREDENTIAL_ID })])
    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      await result.current.start({ credentialId: CREDENTIAL_ID })
    })
    await setJob(makeJob({ credential_id: CREDENTIAL_ID, status: 'awaiting_2fa' }))
    await waitFor(() => expect(result.current.current2fa).not.toBeNull())

    await act(() => result.current.submit2fa(TWO_FACTOR_CODE))
    await setJob(makeJob({ credential_id: CREDENTIAL_ID, status: 'failed', error_code: 'unknown' }))

    await waitFor(() => expect(result.current.failedAt).not.toBeNull())
    expect(result.current.credential(CREDENTIAL_ID)).toEqual({ busy: false, succeededAt: null })
  })

  it('adds a bank to a sync that is already running', async () => {
    const { fetchMock } = installSyncFetchMock([makeJob({ credential_id: OTHER_CREDENTIAL_ID })])
    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      await result.current.start({ credentialId: CREDENTIAL_ID })
    })

    expect(posts(fetchMock)).toEqual(['/api/users/sync', `/api/credentials/${CREDENTIAL_ID}/sync`])
    expect([...result.current.jobs.keys()]).toEqual([OTHER_CREDENTIAL_ID, CREDENTIAL_ID])
    expect(result.current.status).toBe('running')
  })

  it('does not start a bank again while it is still syncing', async () => {
    const { fetchMock } = installSyncFetchMock([makeJob({ credential_id: CREDENTIAL_ID })])
    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      await result.current.start()
    })

    let started: unknown
    await act(async () => {
      started = await result.current.start({ credentialId: CREDENTIAL_ID })
    })

    expect(started).toEqual([])
    expect(posts(fetchMock)).toEqual(['/api/users/sync'])
  })

  it('shows a bank as busy as soon as a full sync is requested', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch
    const { result } = renderHook(() => useAppSync(), { wrapper })

    act(() => void result.current.start())

    expect(result.current.credential(CREDENTIAL_ID).busy).toBe(true)
  })

  it.each([
    ['a full sync', undefined],
    ['the same bank', CREDENTIAL_ID],
  ])('waits for %s that is still starting instead of starting the bank twice', (_, first) => {
    const fetchMock = vi.fn(() => new Promise(() => {}))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { result } = renderHook(() => useAppSync(), { wrapper })
    act(() => void result.current.start({ credentialId: first }))

    act(() => void result.current.start({ credentialId: CREDENTIAL_ID }))

    expect(posts(fetchMock)).toHaveLength(1)
  })
})

describe('useAppSync adopting server jobs', () => {
  it('picks up a bank that is still syncing on the server', async () => {
    const { setJob } = installSyncFetchMock([])
    await setJob(makeJob({ credential_id: CREDENTIAL_ID, status: 'awaiting_2fa' }))
    await setJob(makeJob({ credential_id: OTHER_CREDENTIAL_ID, status: 'completed' }))
    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(() => result.current.adopt())

    expect([...result.current.jobs.keys()]).toEqual([CREDENTIAL_ID])
    expect(result.current.credential(CREDENTIAL_ID).busy).toBe(true)
    await waitFor(() => expect(result.current.current2fa?.credentialId).toBe(CREDENTIAL_ID))
  })

  it('stays idle when nothing runs on the server or it cannot be reached', async () => {
    installSyncFetchMock([])
    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(() => result.current.adopt())
    expect(result.current.status).toBe('idle')

    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch
    await act(() => result.current.adopt())
    expect(result.current.status).toBe('idle')
  })

  it('adds a bank synced elsewhere to the running sync without dropping its own', async () => {
    const { setJob } = installSyncFetchMock([makeJob({ credential_id: CREDENTIAL_ID })])
    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      await result.current.start()
    })
    await setJob(makeJob({ credential_id: OTHER_CREDENTIAL_ID }))

    await act(() => result.current.adopt())

    expect([...result.current.jobs.keys()]).toEqual([CREDENTIAL_ID, OTHER_CREDENTIAL_ID])
    expect(result.current.status).toBe('running')
  })
})
