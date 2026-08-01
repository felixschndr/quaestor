import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useCredentialSync } from '@/lib/auth'
import { installSyncFetchMock, makeJob, wrapper } from '@/test/syncTestHelpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCredentialSync', () => {
  it('sets succeededAt (not failedAt) when the job completes', async () => {
    const { setJob } = installSyncFetchMock([makeJob({ credential_id: 7, job_id: 'j-7' })], {
      global: false,
    })

    const { result } = renderHook(() => useCredentialSync(7), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 7, job_id: 'j-7', status: 'completed' }))

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.succeededAt).not.toBeNull()
    expect(result.current.failedAt).toBeNull()
  })

  it('sets failedAt when the job fails after a 2FA submit', async () => {
    const { setJob } = installSyncFetchMock([makeJob({ credential_id: 7, job_id: 'j-7' })], {
      global: false,
    })

    const { result } = renderHook(() => useCredentialSync(7), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await setJob(makeJob({ credential_id: 7, job_id: 'j-7', status: 'awaiting_2fa' }))
    await waitFor(() => expect(result.current.current2fa).not.toBeNull())

    await act(async () => {
      await result.current.submit2fa('123456')
    })

    await setJob(
      makeJob({
        credential_id: 7,
        job_id: 'j-7',
        status: 'failed',
        error: 'boom',
        error_code: 'unknown',
      }),
    )

    await waitFor(() => expect(result.current.failedAt).not.toBeNull())
    expect(result.current.status).toBe('done')
    expect(result.current.succeededAt).toBeNull()
  })
})
