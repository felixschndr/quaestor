import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useScrollRestoration } from '@/lib/useScrollRestoration'

const KEY = 'stats'
const STORAGE_KEY = `scroll:${KEY}`
const SAVED_POSITION = 500

let scrollTo: ReturnType<typeof vi.spyOn>

function setPageHeight(height: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => height,
  })
}

function scrollWindowTo(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  window.dispatchEvent(new Event('scroll'))
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  scrollTo = vi.spyOn(window, 'scrollTo')
  setPageHeight(window.innerHeight)
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useScrollRestoration', () => {
  it('remembers where the user scrolled to, at most once per frame', () => {
    renderHook(() => useScrollRestoration(KEY))

    scrollWindowTo(100)
    scrollWindowTo(120.4)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    vi.advanceTimersToNextFrame()

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('120')
  })

  it('saves the position when the page is hidden or left', () => {
    const { unmount } = renderHook(() => useScrollRestoration(KEY))

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 80 })
    window.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersToNextFrame()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('80')

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 90 })
    unmount()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('90')
  })

  it('scrolls back to the saved position once the page has grown tall enough', () => {
    sessionStorage.setItem(STORAGE_KEY, String(SAVED_POSITION))
    renderHook(() => useScrollRestoration(KEY))

    vi.advanceTimersToNextFrame()
    expect(scrollTo).not.toHaveBeenCalled()

    setPageHeight(window.innerHeight + SAVED_POSITION)
    vi.advanceTimersToNextFrame()

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, SAVED_POSITION)
    scrollWindowTo(SAVED_POSITION + 10)
    vi.advanceTimersToNextFrame()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(String(SAVED_POSITION + 10))
  })

  it('gives up waiting for the content after about three seconds and scrolls anyway', () => {
    sessionStorage.setItem(STORAGE_KEY, String(SAVED_POSITION))
    renderHook(() => useScrollRestoration(KEY))

    for (let frame = 0; frame < 181; frame++) vi.advanceTimersToNextFrame()
    expect(scrollTo).not.toHaveBeenCalled()

    vi.advanceTimersToNextFrame()
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, SAVED_POSITION)
  })

  it.each(['wheel', 'touchmove', 'keydown'])(
    'lets the user take over with %s instead of jumping later',
    (eventType) => {
      sessionStorage.setItem(STORAGE_KEY, String(SAVED_POSITION))
      renderHook(() => useScrollRestoration(KEY))

      window.dispatchEvent(new Event(eventType))
      window.dispatchEvent(new Event(eventType))
      setPageHeight(window.innerHeight + SAVED_POSITION)
      vi.advanceTimersToNextFrame()

      expect(scrollTo).not.toHaveBeenCalled()
      scrollWindowTo(30)
      vi.advanceTimersToNextFrame()
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe('30')
    },
  )

  it('keeps the saved position when the page is left before it was restored', () => {
    sessionStorage.setItem(STORAGE_KEY, String(SAVED_POSITION))
    const { unmount } = renderHook(() => useScrollRestoration(KEY))

    unmount()
    setPageHeight(window.innerHeight + SAVED_POSITION)
    vi.advanceTimersToNextFrame()

    expect(scrollTo).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(String(SAVED_POSITION))
  })
})
