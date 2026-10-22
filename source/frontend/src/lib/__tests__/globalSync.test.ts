import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ApiError } from '@/lib/api'
import { authQueryKeys, useAppSync } from '@/lib/auth'
import { installSyncFetchMock, makeJob, wrapper } from '@/test/syncTestHelpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAppSync', () => {
  it('starts a job per credential and polls status in one batched request', async () => {
    const { fetchMock } = installSyncFetchMock([
      makeJob({ credential_id: 1, job_id: 'j-1' }),
      makeJob({ credential_id: 2, job_id: 'j-2' }),
    ])

    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(async () => {
      result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('running'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => /\/credentials\/sync$/.test(String(u)))).toBe(true),
    )
    expect(fetchMock.mock.calls.some(([u]) => /\/credentials\/\d+\/sync\/j-/.test(String(u)))).toBe(
      false,
    )
  })

  it('asks the server to pick the due credentials when started unattended', async () => {
    const { fetchMock } = installSyncFetchMock([makeJob({ credential_id: 7, job_id: 'j-7' })])

    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(async () => {
      result.current.start({ dueOnly: true })
    })

    await waitFor(() => expect(result.current.status).toBe('running'))
    const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posted.map(([u]) => String(u))).toEqual(['/api/users/sync?due_only=true'])
  })

  it('asks for every credential when the user started the sync', async () => {
    const { fetchMock } = installSyncFetchMock([makeJob({ credential_id: 7, job_id: 'j-7' })])

    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(async () => {
      result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('running'))
    const posted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posted.map(([u]) => String(u))).toEqual(['/api/users/sync'])
  })

  it('serializes concurrent 2FA prompts into the queue', async () => {
    const { setJob } = installSyncFetchMock([
      makeJob({ credential_id: 1, job_id: 'j-1' }),
      makeJob({ credential_id: 2, job_id: 'j-2' }),
    ])

    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'awaiting_2fa' }))
    await setJob(makeJob({ credential_id: 2, job_id: 'j-2', status: 'awaiting_2fa' }))

    await waitFor(() => expect(result.current.current2fa).not.toBeNull())
    expect(result.current.current2fa?.credentialId).toBe(1)
    expect(result.current.status).toBe('awaiting_2fa')
  })

  it('skip2fa advances to the next queued credential', async () => {
    const { setJob } = installSyncFetchMock([
      makeJob({ credential_id: 1, job_id: 'j-1' }),
      makeJob({ credential_id: 2, job_id: 'j-2' }),
    ])

    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'awaiting_2fa' }))
    await setJob(makeJob({ credential_id: 2, job_id: 'j-2', status: 'awaiting_2fa' }))
    await waitFor(() => expect(result.current.current2fa?.credentialId).toBe(1))

    act(() => result.current.skip2fa())

    await waitFor(() => expect(result.current.current2fa?.credentialId).toBe(2))
  })

  it('transitions to done when all jobs reach a terminal state', async () => {
    const { setJob } = installSyncFetchMock([makeJob({ credential_id: 1, job_id: 'j-1' })])

    const { result } = renderHook(() => useAppSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'completed' }))

    await waitFor(() => expect(result.current.status).toBe('done'))
  })
})

describe('useAppSync edge cases', () => {
  function clientWithUser() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(authQueryKeys.me, {
      id: 1,
      credentials: [{ id: 1, bank: 'fints', bank_name: 'DKB', bank_icon: 'dkb.svg', accounts: [] }],
    })
    return ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
  }

  const requests = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)

  async function startedSync(jobs = [makeJob({ credential_id: 1, job_id: 'j-1' })]) {
    const api = installSyncFetchMock(jobs)
    const hook = renderHook(() => useAppSync(), { wrapper: clientWithUser() })
    await act(async () => hook.result.current.start())
    return { ...api, ...hook }
  }

  it('ignores another start while a sync is running', async () => {
    const { fetchMock, result } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))

    act(() => result.current.start())

    expect(requests(fetchMock).filter((r) => r.startsWith('POST'))).toEqual([
      'POST /api/users/sync',
    ])
  })

  it('is done right away when no bank is due, without claiming success or failure', async () => {
    const { result } = await startedSync([])

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.succeededAt).toBeNull()
    expect(result.current.failedAt).toBeNull()
  })

  it.each([
    ['the server rejects it', () => new Response('{}', { status: 409 }), ApiError],
    ['the server is unreachable', () => Promise.reject(new TypeError('Failed to fetch')), null],
  ])('reports a failed start when %s', async (_, respond, errorType) => {
    globalThis.fetch = vi.fn(respond) as unknown as typeof fetch
    const { result } = renderHook(() => useAppSync(), { wrapper })

    await act(async () => result.current.start())

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.failedAt).toEqual(expect.any(Number))
    if (errorType) expect(result.current.startError).toBeInstanceOf(errorType)
    else expect(result.current.startError).toBeNull()
  })

  it.each([
    ['awaiting_decoupled_approval', 'awaiting_decoupled_approval'],
    ['confirming_2fa', 'confirming'],
    ['awaiting_2fa', 'awaiting_2fa'],
  ] as const)('shows the bank behind a %s job as %s', async (status, kind) => {
    const { result, setJob } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status }))

    await waitFor(() => expect(result.current.current2fa?.kind).toBe(kind))
    expect(result.current.current2fa).toMatchObject({
      credentialId: 1,
      jobId: 'j-1',
      bank: 'fints',
      bankName: 'DKB',
      bankIcon: 'dkb.svg',
    })
  })

  it('sends the entered code to the bank waiting for it', async () => {
    const { result, setJob, fetchMock } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))
    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'awaiting_2fa' }))
    await waitFor(() => expect(result.current.status).toBe('awaiting_2fa'))

    await act(() => result.current.submit2fa('123456'))

    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/2fa'))!
    expect(requests(fetchMock)).toContain('POST /api/credentials/1/sync/j-1/2fa')
    expect(JSON.parse(init.body)).toEqual({ code: '123456' })
  })

  it('cancels a skipped job on the server', async () => {
    const { result, setJob, fetchMock } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))
    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'awaiting_2fa' }))
    await waitFor(() => expect(result.current.status).toBe('awaiting_2fa'))

    act(() => result.current.skip2fa())

    await waitFor(() => expect(requests(fetchMock)).toContain('DELETE /api/credentials/1/sync/j-1'))
    expect(result.current.current2fa).toBeNull()
  })

  it('has nothing to submit or skip while no bank asks for a code', async () => {
    const { result, fetchMock } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))
    const before = fetchMock.mock.calls.length

    await act(() => result.current.submit2fa('123456'))
    act(() => result.current.skip2fa())

    expect(
      requests(fetchMock)
        .slice(before)
        .filter((r) => !r.startsWith('GET')),
    ).toEqual([])
  })

  it.each([
    ['every bank synced', ['completed', null], 'succeededAt'],
    ['a bank failed', ['failed', 'timeout'], 'failedAt'],
  ] as const)('timestamps the outcome when %s', async (_, [status, errorCode], field) => {
    const { result, setJob } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status, error_code: errorCode }))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current[field]).toEqual(expect.any(Number))
  })

  it('claims neither success nor failure when the user cancelled every bank', async () => {
    const { result, setJob } = await startedSync()
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(
      makeJob({ credential_id: 1, job_id: 'j-1', status: 'failed', error_code: 'cancelled' }),
    )

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.succeededAt).toBeNull()
    expect(result.current.failedAt).toBeNull()
  })
})
