import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlineManager, QueryClient } from '@tanstack/react-query'

import { api, NetworkError } from '@/lib/api'
import {
  isOfflineCacheEnabled,
  reportServerReachable,
  setOfflineCacheEnabled,
  startOfflineCache,
  suggestOfflineCache,
} from '@/lib/offlineCache'

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

describe('server probe while unreachable', () => {
  const PROBE_INTERVAL_MS = 15_000

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks the server every 15 seconds until it answers, then stops', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    reportServerReachable(false)
    reportServerReachable(false)
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/settings', {
      credentials: 'same-origin',
    })
    expect(onlineManager.isOnline()).toBe(false)

    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    expect(onlineManager.isOnline()).toBe(true)

    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps asking while the network is down', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    reportServerReachable(false)
    await vi.advanceTimersByTimeAsync(2 * PROBE_INTERVAL_MS)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onlineManager.isOnline()).toBe(false)
  })
})

describe('offline cache preference', () => {
  it.each([
    [null, true, false],
    ['on', true, true],
    ['off', false, false],
  ])('stored %s: suggested %s, enabled %s', (stored, suggested, enabled) => {
    if (stored === null) window.localStorage.removeItem('offlineCache')
    else window.localStorage.setItem('offlineCache', stored)

    expect(suggestOfflineCache()).toBe(suggested)
    expect(isOfflineCacheEnabled()).toBe(enabled)
  })
})

const idb = {
  entries: new Map<string, string>(),
  failDeletes: false,
}

function settle<T>(run: () => T) {
  const request = {
    result: undefined as T | undefined,
    error: null as unknown,
    onsuccess: null as null | (() => void),
    onerror: null as null | (() => void),
  }
  queueMicrotask(() => {
    try {
      request.result = run()
      request.onsuccess?.()
    } catch (error) {
      request.error = error
      request.onerror?.()
    }
  })
  return request
}

const objectStore = {
  get: (key: string) => settle(() => idb.entries.get(key)),
  put: (value: string, key: string) => settle(() => void idb.entries.set(key, value)),
  delete: (key: string) =>
    settle(() => {
      if (idb.failDeletes) throw new DOMException('The operation failed', 'UnknownError')
      idb.entries.delete(key)
    }),
}
const database = {
  transaction: () => ({ objectStore: () => objectStore }),
  createObjectStore: vi.fn(),
}

describe('offline cache storage', () => {
  const CONTRACTS = [{ id: 1, name: 'Netflix' }]
  const queryClient = () => new QueryClient()

  beforeAll(() => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = {
          result: database,
          onupgradeneeded: null as null | (() => void),
          onsuccess: null as null | (() => void),
        }
        queueMicrotask(() => {
          request.onupgradeneeded?.()
          request.onsuccess?.()
        })
        return request
      },
    })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.removeItem('offlineCache')
    idb.entries.clear()
    idb.failDeletes = false
  })

  afterEach(async () => {
    idb.failDeletes = false
    await setOfflineCacheEnabled(queryClient(), false)
    vi.useRealTimers()
  })

  async function keepOnDevice(client: QueryClient) {
    await setOfflineCacheEnabled(client, true)
    client.setQueryData(['contracts'], CONTRACTS)
    await vi.advanceTimersByTimeAsync(1000)
  }

  it('keeps loaded data on the device and brings it back on the next start', async () => {
    await keepOnDevice(queryClient())
    expect(database.createObjectStore).toHaveBeenCalledWith('cache')
    expect(idb.entries.size).toBe(1)

    const nextStart = queryClient()
    await startOfflineCache(nextStart)

    expect(nextStart.getQueryData(['contracts'])).toEqual(CONTRACTS)
    expect(window.localStorage.getItem('offlineCache')).toBe('on')
  })

  it('leaves stored data alone unless the cache is switched on', async () => {
    await keepOnDevice(queryClient())
    window.localStorage.removeItem('offlineCache')

    const nextStart = queryClient()
    await startOfflineCache(nextStart)

    expect(nextStart.getQueryData(['contracts'])).toBeUndefined()
  })

  it('forgets the stored data and stops saving once switched off', async () => {
    const client = queryClient()
    await keepOnDevice(client)

    await setOfflineCacheEnabled(client, false)
    expect(idb.entries.size).toBe(0)
    expect(window.localStorage.getItem('offlineCache')).toBe('off')

    client.setQueryData(['contracts'], [])
    await vi.advanceTimersByTimeAsync(1000)
    expect(idb.entries.size).toBe(0)
  })

  it('switches off even when the storage refuses to delete', async () => {
    const client = queryClient()
    await keepOnDevice(client)
    idb.failDeletes = true

    await expect(setOfflineCacheEnabled(client, false)).resolves.toBeUndefined()

    expect(isOfflineCacheEnabled()).toBe(false)
  })
})
