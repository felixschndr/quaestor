import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SMALL_SCREEN_UP, useMediaQuery } from '../useMediaQuery'

function stubScreen(matches: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    resize(next: boolean) {
      media.matches = next
      act(() => listeners.forEach((listener) => listener()))
    },
    listeners,
  }
}

describe('useMediaQuery', () => {
  it('follows the screen as it changes', () => {
    const screen = stubScreen(false)
    const { result, unmount } = renderHook(() => useMediaQuery(SMALL_SCREEN_UP))
    expect(result.current).toBe(false)

    screen.resize(true)
    expect(result.current).toBe(true)

    unmount()
    expect(screen.listeners.size).toBe(0)
  })

  it.each([true, false])('falls back to %s where matchMedia is missing', (fallback) => {
    vi.stubGlobal('matchMedia', undefined)

    const { result } = renderHook(() => useMediaQuery(SMALL_SCREEN_UP, fallback))

    expect(result.current).toBe(fallback)
  })
})
