import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'

import '@/i18n'
import { installSyncFetchMock, makeJob } from '@/test/syncTestHelpers'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks(),
)

import { SyncProvider, useCredentialSync } from '@/components/sync-provider'

const CREDENTIAL_ID = 7

function BankPage() {
  const sync = useCredentialSync(CREDENTIAL_ID)
  return (
    <button type="button" onClick={sync.start}>
      {sync.busy ? 'Syncing' : 'Sync'}
    </button>
  )
}

it('still shows a running bank sync after leaving its page and coming back', async () => {
  const { fetchMock } = installSyncFetchMock([makeJob({ credential_id: CREDENTIAL_ID })])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const app = (onBankPage: boolean) => (
    <QueryClientProvider client={client}>
      <SyncProvider>{onBankPage ? <BankPage /> : null}</SyncProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(app(true))

  await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
  await waitFor(() =>
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/credentials/sync'),
  )
  rerender(app(false))
  rerender(app(true))

  expect(screen.getByRole('button', { name: 'Syncing' })).toBeInTheDocument()
})
