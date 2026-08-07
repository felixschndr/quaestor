import { useCallback, useState } from 'react'

import { safeStorage } from './storage'

export const STORAGE_KEY = 'collapsedGroups'

export const EXPECTED_TRANSACTIONS_KEY = 'expectedTransactions'

export const UPCOMING_CONTRACTS_KEY = 'upcomingContracts'

const store = safeStorage(STORAGE_KEY, 'local')

export function readCollapsed(): Set<string> {
  const raw = store.read()
  if (!raw) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((key): key is string => typeof key === 'string'))
  } catch {
    return new Set()
  }
}

export function writeCollapsed(keys: Set<string>): void {
  store.write(JSON.stringify([...keys]))
}

export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)

  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed])

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsed(next)
      return next
    })
  }, [])

  return { isCollapsed, toggle }
}
