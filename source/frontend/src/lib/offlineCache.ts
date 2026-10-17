import { onlineManager, type QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'

import { safeStorage } from './storage'

const preference = safeStorage('offlineCache', 'local')

export const OFFLINE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SERVER_PROBE_INTERVAL_MS = 15_000
const BUSTER = String(import.meta.env.VITE_BUILD_ID ?? '')

const persister = createAsyncStoragePersister({
  storage: indexedDbStorage(),
  key: 'quaestor-query-cache',
})
let unsubscribe: (() => void) | null = null

export function isOfflineCacheEnabled(): boolean {
  return preference.read() === 'on'
}

export function suggestOfflineCache(): boolean {
  return preference.read() !== 'off'
}

export async function startOfflineCache(queryClient: QueryClient): Promise<void> {
  if (!isOfflineCacheEnabled()) return
  await persistQueryClientRestore({
    queryClient,
    persister,
    maxAge: OFFLINE_CACHE_MAX_AGE_MS,
    buster: BUSTER,
  })
  subscribe(queryClient)
}

export async function setOfflineCacheEnabled(
  queryClient: QueryClient,
  enabled: boolean,
): Promise<void> {
  preference.write(enabled ? 'on' : 'off')
  if (enabled) {
    subscribe(queryClient)
    return
  }
  unsubscribe?.()
  unsubscribe = null
  await clearOfflineCache()
}

export async function clearOfflineCache(): Promise<void> {
  try {
    await persister.removeClient()
  } catch {
    // Nothing stored or storage unavailable
  }
}

function subscribe(queryClient: QueryClient) {
  unsubscribe ??= persistQueryClientSubscribe({ queryClient, persister, buster: BUSTER })
}

export const SERVER_UNREACHABLE_STATUSES = new Set([502, 503, 504])

let probe: ReturnType<typeof setInterval> | null = null

export function reportServerReachable(reachable: boolean) {
  onlineManager.setOnline(reachable)
  if (reachable) {
    if (probe !== null) clearInterval(probe)
    probe = null
    return
  }
  probe ??= setInterval(() => {
    fetch('/api/settings', { credentials: 'same-origin' })
      .then((response) => reportServerReachable(!SERVER_UNREACHABLE_STATUSES.has(response.status)))
      .catch(() => {})
  }, SERVER_PROBE_INTERVAL_MS)
}

function indexedDbStorage() {
  let database: Promise<IDBDatabase> | null = null
  const open = () =>
    (database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('quaestor-offline', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('cache')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }))
  const run = <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const request = action(db.transaction('cache', mode).objectStore('cache'))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        }),
    )
  return {
    getItem: (key: string) => run<string | undefined>('readonly', (store) => store.get(key)),
    setItem: async (key: string, value: string) => {
      await run('readwrite', (store) => store.put(value, key))
    },
    removeItem: async (key: string) => {
      await run('readwrite', (store) => store.delete(key))
    },
  }
}
