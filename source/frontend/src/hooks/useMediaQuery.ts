import { useSyncExternalStore } from 'react'

export const SMALL_SCREEN_UP = '(min-width: 40rem)'

export function useMediaQuery(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query)
      media?.addEventListener('change', onChange)
      return () => media?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? fallback,
  )
}
