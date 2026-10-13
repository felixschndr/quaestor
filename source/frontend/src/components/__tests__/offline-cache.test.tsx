import { act } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from 'i18next'

import '@/i18n'

import { OfflineBanner } from '@/components/offline-banner'
import { OfflineCacheSetting } from '@/components/offline-cache-toggle'
import { authQueryKeys } from '@/lib/auth'
import { isOfflineCacheEnabled } from '@/lib/offlineCache'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('OfflineCacheSetting', () => {
  it('stays off on a device that never decided, until the user switches it on', async () => {
    window.localStorage.removeItem('offlineCache')
    const queryClient = new QueryClient()
    queryClient.setQueryData(authQueryKeys.me, { id: 1, credentials: [{ accounts: [{ id: 3 }] }] })
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    ) as unknown as typeof fetch
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineCacheSetting />
      </QueryClientProvider>,
    )
    const toggle = screen.getByRole('switch', { name: 'Keep data on this device' })
    expect(toggle).not.toBeChecked()
    expect(isOfflineCacheEnabled()).toBe(false)

    await userEvent.click(toggle)

    expect(toggle).toBeChecked()
    expect(isOfflineCacheEnabled()).toBe(true)
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/account/3/history?page=1',
        expect.anything(),
      ),
    )
  })
})

describe('OfflineBanner', () => {
  it('shows only while the server is unreachable', () => {
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()

    act(() => onlineManager.setOnline(false))

    expect(screen.getByRole('status')).toHaveTextContent('Server unreachable')
  })
})
