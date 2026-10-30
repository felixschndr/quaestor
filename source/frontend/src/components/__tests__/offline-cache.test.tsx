import { act } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient } from '@tanstack/react-query'
import i18n from 'i18next'

import '@/i18n'

import { OfflineBanner, ReadOnlyWhileOffline } from '@/components/offline-banner'
import { OfflineCacheSetting } from '@/components/offline-cache-toggle'
import { authQueryKeys } from '@/lib/auth'
import { isOfflineCacheEnabled } from '@/lib/offlineCache'
import { jsonResponse, renderWithQuery } from '@/test/helpers'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('OfflineCacheSetting', () => {
  it('stays off on a device that never decided, until the user switches it on', async () => {
    window.localStorage.removeItem('offlineCache')
    const queryClient = new QueryClient()
    queryClient.setQueryData(authQueryKeys.me, { id: 1, credentials: [{ accounts: [{ id: 3 }] }] })
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 200, body: [] })),
    ) as unknown as typeof fetch
    renderWithQuery(<OfflineCacheSetting />, queryClient)
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

describe('ReadOnlyWhileOffline', () => {
  it('disables the controls inside while offline, but not links', () => {
    render(
      <ReadOnlyWhileOffline>
        <button type="button">Delete</button>
        <a href="/account/3">Account</a>
      </ReadOnlyWhileOffline>,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()

    act(() => onlineManager.setOnline(false))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account/3')
  })
})
