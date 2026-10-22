import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  useResolvedTheme,
  writeStoredTheme,
} from '../theme'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  document.documentElement.className = ''
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveTheme', () => {
  it('returns the explicit value for LIGHT and DARK', () => {
    expect(resolveTheme('LIGHT')).toBe('LIGHT')
    expect(resolveTheme('DARK')).toBe('DARK')
  })

  it('returns DARK for SYSTEM when the OS prefers dark', () => {
    mockMatchMedia(true)
    expect(resolveTheme('SYSTEM')).toBe('DARK')
  })

  it('returns LIGHT for SYSTEM when the OS prefers light', () => {
    mockMatchMedia(false)
    expect(resolveTheme('SYSTEM')).toBe('LIGHT')
  })
})

describe('resolveTheme without matchMedia', () => {
  it('assumes a dark OS when the browser cannot tell', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('SYSTEM')).toBe('DARK')
  })
})

describe('applyTheme', () => {
  it('sets the dark class for an explicit DARK preference', () => {
    applyTheme('DARK')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('sets the light class for an explicit LIGHT preference', () => {
    applyTheme('LIGHT')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('resolves SYSTEM via prefers-color-scheme', () => {
    mockMatchMedia(false)
    applyTheme('SYSTEM')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})

describe('readStoredTheme / writeStoredTheme', () => {
  it('defaults to SYSTEM when nothing is stored', () => {
    expect(readStoredTheme()).toBe('SYSTEM')
  })

  it('round-trips a stored value', () => {
    writeStoredTheme('LIGHT')
    expect(readStoredTheme()).toBe('LIGHT')
  })

  it('ignores garbage values and falls back to SYSTEM', () => {
    window.localStorage.setItem('theme', 'neon')
    expect(readStoredTheme()).toBe('SYSTEM')
  })
})

describe('useResolvedTheme', () => {
  function mockOsTheme(prefersDark: boolean) {
    const listeners = new Set<() => void>()
    const media = {
      matches: prefersDark,
      addEventListener: vi.fn((_: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_: string, listener: () => void) => listeners.delete(listener)),
    }
    window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia
    return {
      flip(next: boolean) {
        media.matches = next
        act(() => listeners.forEach((listener) => listener()))
      },
      listeners,
    }
  }

  it('applies an explicit preference and remembers it for the next start', () => {
    mockOsTheme(false)
    const { result } = renderHook(() => useResolvedTheme('DARK'))

    expect(result.current).toBe('DARK')
    expect(document.documentElement).toHaveClass('dark')
    expect(readStoredTheme()).toBe('DARK')
  })

  it('follows the OS while set to SYSTEM, also when it flips with the tab open', () => {
    const os = mockOsTheme(true)
    const { result } = renderHook(() => useResolvedTheme('SYSTEM'))
    expect(result.current).toBe('DARK')
    expect(document.documentElement).toHaveClass('dark')

    os.flip(false)

    expect(result.current).toBe('LIGHT')
    expect(document.documentElement).toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('ignores the OS for an explicit preference', () => {
    const os = mockOsTheme(true)
    const { result } = renderHook(() => useResolvedTheme('LIGHT'))

    os.flip(true)

    expect(result.current).toBe('LIGHT')
    expect(document.documentElement).toHaveClass('light')
  })

  it('stops listening to the OS once unmounted', () => {
    const os = mockOsTheme(true)
    const { unmount } = renderHook(() => useResolvedTheme('SYSTEM'))
    expect(os.listeners.size).toBe(1)

    unmount()

    expect(os.listeners.size).toBe(0)
  })
})
