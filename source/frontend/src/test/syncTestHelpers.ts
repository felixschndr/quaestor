import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { vi } from 'vitest'

import type { SyncJob } from '@/lib/credentials'

export function makeJob(overrides: Partial<SyncJob> & Pick<SyncJob, 'credential_id'>): SyncJob {
  return {
    job_id: `job-${overrides.credential_id}`,
    status: 'running',
    expires_at: null,
    error: null,
    error_code: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export interface SyncFetchMock {
  fetchMock: ReturnType<typeof vi.fn>
  setJob: (job: SyncJob) => Promise<void>
}

export function installSyncFetchMock(
  initialJobs: SyncJob[],
  opts: { global?: boolean } = {},
): SyncFetchMock {
  const isGlobal = opts.global ?? true
  const store = new Map<number, SyncJob>()

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && /\/sync$/.test(url)) {
      for (const job of initialJobs) store.set(job.credential_id, job)
      return jsonResponse(isGlobal ? initialJobs : initialJobs[0], 202)
    }
    if (method === 'POST' && /\/2fa$/.test(url)) {
      const id = Number(url.match(/credentials\/(\d+)\//)![1])
      return jsonResponse(store.get(id) ?? null, 202)
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    if (method === 'GET' && /\/credentials\/sync$/.test(url)) {
      return jsonResponse(Array.from(store.values()), 200)
    }
    const match = url.match(/credentials\/(\d+)\/sync\//)
    if (match) {
      const job = store.get(Number(match[1]))
      return jsonResponse(job ?? null, job ? 200 : 404)
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch

  return {
    fetchMock,
    async setJob(job: SyncJob) {
      store.set(job.credential_id, job)
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    },
  }
}

export function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return createElement(QueryClientProvider, { client }, children)
}
