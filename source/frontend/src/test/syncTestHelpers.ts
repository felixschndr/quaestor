import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

import type { SyncJob } from '@/lib/credentials'

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  url: string
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    // Defer onopen so the hook gets to attach handlers first.
    queueMicrotask(() => this.onopen?.(new Event('open')))
  }

  send() {}
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  pushJob(job: SyncJob) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(job) }))
  }
}

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

export function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return createElement(QueryClientProvider, { client }, children)
}
