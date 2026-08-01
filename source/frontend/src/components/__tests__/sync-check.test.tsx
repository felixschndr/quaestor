import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { CHECK_HOLD_MS, CHECK_ZOOM_MS, useSuccessCheck } from '../sync-check'

const FULL_ANIMATION_MS = CHECK_ZOOM_MS + CHECK_HOLD_MS + CHECK_ZOOM_MS + 100

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useSuccessCheck', () => {
  it('replays the check when the tab returns after the sync completed in the background', () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })

    const { result, rerender } = renderHook(({ at }) => useSuccessCheck(at), {
      initialProps: { at: null as number | null },
    })

    act(() => rerender({ at: 1000 }))
    expect(result.current.mounted).toBe(false)
    act(() => vi.advanceTimersByTime(FULL_ANIMATION_MS))
    expect(result.current.mounted).toBe(false)

    act(() => setVisibility('visible'))
    expect(result.current.mounted).toBe(true)
  })

  it('does not replay a check that already played while visible', () => {
    vi.useFakeTimers()

    const { result, rerender } = renderHook(({ at }) => useSuccessCheck(at), {
      initialProps: { at: null as number | null },
    })

    act(() => rerender({ at: 1000 }))
    expect(result.current.mounted).toBe(true)
    act(() => vi.advanceTimersByTime(FULL_ANIMATION_MS))
    expect(result.current.mounted).toBe(false)

    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    expect(result.current.mounted).toBe(false)
  })
})
