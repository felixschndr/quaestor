import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useCredentialSync } from '@/lib/auth'
import { MockWebSocket, makeJob, wrapper } from '@/test/syncTestHelpers'

function startResponse(credentialId: number): Response {
  return new Response(
    JSON.stringify(makeJob({ credential_id: credentialId, job_id: `j-${credentialId}` })),
    { status: 202, headers: { 'content-type': 'application/json' } },
  )
}

beforeEach(() => {
  MockWebSocket.instances = []
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCredentialSync', () => {
  it('sets succeededAt (not failedAt) when the job completes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(startResponse(7)) as unknown as typeof fetch

    const { result } = renderHook(() => useCredentialSync(7), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))

    await act(async () => {
      MockWebSocket.instances[0].pushJob(makeJob({ credential_id: 7, status: 'completed' }))
    })

    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.succeededAt).not.toBeNull()
    expect(result.current.failedAt).toBeNull()
  })

  it('sets failedAt when the job fails after a 2FA submit', async () => {
    // start() POST, then the 2FA submit POST — both resolve 200; the failure is
    // delivered out-of-band over the WebSocket, exactly like the Trade Republic
    // BAD_SUBSCRIPTION_TYPE error that surfaces inside the background confirm.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(startResponse(7))
      .mockResolvedValueOnce(startResponse(7)) as unknown as typeof fetch

    const { result } = renderHook(() => useCredentialSync(7), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))

    await act(async () => {
      MockWebSocket.instances[0].pushJob(makeJob({ credential_id: 7, status: 'awaiting_2fa' }))
    })
    await waitFor(() => expect(result.current.current2fa).not.toBeNull())

    await act(async () => {
      await result.current.submit2fa('123456')
    })

    // Background confirm dies → WebSocket announces the terminal failure.
    await act(async () => {
      MockWebSocket.instances[0].pushJob(
        makeJob({ credential_id: 7, status: 'failed', error: 'boom', error_code: 'unknown' }),
      )
    })

    await waitFor(() => expect(result.current.failedAt).not.toBeNull())
    expect(result.current.status).toBe('done')
    expect(result.current.succeededAt).toBeNull()
  })
})
