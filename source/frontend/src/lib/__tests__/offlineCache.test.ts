import { describe, expect, it, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'

import { api, NetworkError } from '@/lib/api'

describe('server reachability', () => {
  it('goes offline when the server cannot be reached', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch

    await expect(api('/accounts')).rejects.toBeInstanceOf(NetworkError)

    expect(onlineManager.isOnline()).toBe(false)
  })

  it('treats a reverse proxy without its backend as unreachable', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('Bad Gateway', { status: 502 })) as unknown as typeof fetch

    await expect(api('/accounts')).rejects.toBeInstanceOf(NetworkError)

    expect(onlineManager.isOnline()).toBe(false)
  })

  it('goes back online with the first answer from the server', async () => {
    onlineManager.setOnline(false)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ) as unknown as typeof fetch

    await api('/accounts')

    expect(onlineManager.isOnline()).toBe(true)
  })
})
