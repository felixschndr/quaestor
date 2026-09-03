import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { consumeClickedNotification, unreadCount } from '@/lib/notificationLog'

function visit(url: string) {
  window.history.replaceState(null, '', url)
}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
  visit('/')
})

describe('consumeClickedNotification', () => {
  it('marks the clicked entry read and strips the hash from the url', async () => {
    visit('/contracts/7?foo=bar#n=12')

    expect(await consumeClickedNotification(new QueryClient())).toBe(12)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/notification_log/12/read'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(window.location.hash).toBe('')
    expect(window.location.pathname + window.location.search).toBe('/contracts/7?foo=bar')
  })

  it('does nothing on a url the service worker did not tag', async () => {
    visit('/contracts/7#section')

    expect(await consumeClickedNotification(new QueryClient())).toBeNull()

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#section')
  })

  it('still clears the hash when the entry is already gone', async () => {
    visit('/#n=99')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch

    await expect(consumeClickedNotification(new QueryClient())).resolves.toBe(99)

    expect(window.location.hash).toBe('')
  })
})

describe('unreadCount', () => {
  it('counts only entries without a read timestamp', () => {
    expect(unreadCount(undefined)).toBe(0)
    expect(
      unreadCount([
        { id: 1, title: 'a', body: 'b', url: null, created_at: '', read_at: null },
        {
          id: 2,
          title: 'a',
          body: 'b',
          url: null,
          created_at: '',
          read_at: '2026-09-03T10:00:00Z',
        },
      ]),
    ).toBe(1)
  })
})
