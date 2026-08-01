import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useGlobalSync } from '@/lib/auth'
import { installSyncFetchMock, makeJob, wrapper } from '@/test/syncTestHelpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGlobalSync', () => {
  it('starts a job per credential and polls each', async () => {
    const { fetchMock } = installSyncFetchMock([
      makeJob({ credential_id: 1, job_id: 'j-1' }),
      makeJob({ credential_id: 2, job_id: 'j-2' }),
    ])

    const { result } = renderHook(() => useGlobalSync(), { wrapper })

    await act(async () => {
      result.current.start()
    })

    await waitFor(() => expect(result.current.status).toBe('running'))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/credentials/1/sync/j-1')),
      ).toBe(true),
    )
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/credentials/2/sync/j-2'))).toBe(
      true,
    )
  })

  it('serializes concurrent 2FA prompts into the queue', async () => {
    const { setJob } = installSyncFetchMock([
      makeJob({ credential_id: 1, job_id: 'j-1' }),
      makeJob({ credential_id: 2, job_id: 'j-2' }),
    ])

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
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

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
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

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 1, job_id: 'j-1', status: 'completed' }))

    await waitFor(() => expect(result.current.status).toBe('done'))
  })
})
