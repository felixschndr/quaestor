import { useCallback, useState } from 'react'

/**
 * Tracks which overview account groups the user has collapsed. Persisted to
 * localStorage per device (mirrors the pattern in {@link ./theme}).
 *
 * Stored shape: a JSON array of the collapsed groups' keys (the
 * `DisplayGroup.key`, e.g. `group-123`, `ungrouped`). Semantics: a key that is
 * *absent* counts as expanded, so brand-new groups default to open and a
 * missing/corrupt value degrades safely to "everything expanded".
 */
export const STORAGE_KEY = 'collapsedGroups'

export function readCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  const raw = window.localStorage?.getItem(STORAGE_KEY)
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
  if (typeof window === 'undefined') return
  window.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...keys]))
}

export interface CollapsedGroups {
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
}

export function useCollapsedGroups(): CollapsedGroups {
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
