import { useEffect, useSyncExternalStore } from 'react'

import type { Theme } from './auth'

export const THEME_VALUES: readonly Theme[] = ['LIGHT', 'DARK', 'SYSTEM']
export const STORAGE_KEY = 'theme'

type Resolved = 'LIGHT' | 'DARK'

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function resolveTheme(theme: Theme): Resolved {
  if (theme === 'SYSTEM') return systemPrefersDark() ? 'DARK' : 'LIGHT'
  return theme
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'DARK')
  root.classList.toggle('light', resolved === 'LIGHT')
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'SYSTEM'
  const raw = window.localStorage?.getItem(STORAGE_KEY)
  return THEME_VALUES.includes(raw as Theme) ? (raw as Theme) : 'SYSTEM'
}

export function writeStoredTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  window.localStorage?.setItem(STORAGE_KEY, theme)
}

function subscribePrefersDark(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

/**
 * Apply `theme` to `<html>`, mirror it to localStorage so the next bootstrap
 * picks the same theme before /auth/me resolves (avoids FOUC), and — for
 * `SYSTEM` — keep the page in sync if the OS preference flips while the tab is
 * open. Returns the resolved theme so callers (e.g. `<Toaster>`) can read it.
 */
export function useResolvedTheme(theme: Theme): Resolved {
  const prefersDark = useSyncExternalStore(
    subscribePrefersDark,
    () => systemPrefersDark(),
    () => true,
  )

  useEffect(() => {
    applyTheme(theme)
    writeStoredTheme(theme)
  }, [theme])

  // Re-apply the resolved theme to the DOM when the OS flips while preference
  // is SYSTEM. The class toggle is idempotent, so this is a no-op otherwise.
  useEffect(() => {
    if (theme === 'SYSTEM') applyTheme('SYSTEM')
  }, [theme, prefersDark])

  return theme === 'SYSTEM' ? (prefersDark ? 'DARK' : 'LIGHT') : theme
}
