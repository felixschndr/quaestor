import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useGlobalSync } from '@/lib/auth'
import { MockWebSocket, makeJob, wrapper } from '@/test/syncTestHelpers'

beforeEach(() => {
  MockWebSocket.instances = []
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGlobalSync', () => {
  it('starts a job per credential and opens one WebSocket each', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { job_id: 'j-1', credential_id: 1, status: 'running', expires_at: null, error: null },
          { job_id: 'j-2', credential_id: 2, status: 'running', expires_at: null, error: null },
        ]),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { result } = renderHook(() => useGlobalSync(), { wrapper })

    await act(async () => {
      result.current.start()
    })

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    expect(MockWebSocket.instances[0].url).toContain('/credentials/1/sync/j-1/ws')
    expect(MockWebSocket.instances[1].url).toContain('/credentials/2/sync/j-2/ws')
    expect(result.current.status).toBe('running')
  })

  it('serializes concurrent 2FA prompts into the queue', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { job_id: 'j-1', credential_id: 1, status: 'running', expires_at: null, error: null },
          { job_id: 'j-2', credential_id: 2, status: 'running', expires_at: null, error: null },
        ]),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))

    await act(async () => {
      MockWebSocket.instances[0].pushJob(
        makeJob({ credential_id: 1, status: 'awaiting_2fa', expires_at: null }),
      )
      MockWebSocket.instances[1].pushJob(
        makeJob({ credential_id: 2, status: 'awaiting_2fa', expires_at: null }),
      )
    })

    await waitFor(() => expect(result.current.current2fa).not.toBeNull())
    expect(result.current.current2fa?.credentialId).toBe(1)
    expect(result.current.status).toBe('awaiting_2fa')
  })

  it('skip2fa advances to the next queued credential', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { job_id: 'j-1', credential_id: 1, status: 'running', expires_at: null, error: null },
          { job_id: 'j-2', credential_id: 2, status: 'running', expires_at: null, error: null },
        ]),
        { status: 202, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2))

    await act(async () => {
      MockWebSocket.instances[0].pushJob(makeJob({ credential_id: 1, status: 'awaiting_2fa' }))
      MockWebSocket.instances[1].pushJob(makeJob({ credential_id: 2, status: 'awaiting_2fa' }))
    })
    await waitFor(() => expect(result.current.current2fa?.credentialId).toBe(1))

    act(() => result.current.skip2fa())

    await waitFor(() => expect(result.current.current2fa?.credentialId).toBe(2))
  })

  it('transitions to done when all jobs reach a terminal state', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { job_id: 'j-1', credential_id: 1, status: 'running', expires_at: null, error: null },
          ]),
          { status: 202, headers: { 'content-type': 'application/json' } },
        ),
      ) as unknown as typeof fetch

    const { result } = renderHook(() => useGlobalSync(), { wrapper })
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))

    await act(async () => {
      MockWebSocket.instances[0].pushJob(makeJob({ credential_id: 1, status: 'completed' }))
    })

    await waitFor(() => expect(result.current.status).toBe('done'))
  })
})
