import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  useResolvedTheme,
  writeStoredTheme,
} from '../theme'

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

beforeEach(() => {
  document.documentElement.className = ''
  window.localStorage.clear()
})

describe('resolveTheme', () => {
  it.each(['LIGHT', 'DARK'] as const)('returns the explicit value for %s', (theme) => {
    expect(resolveTheme(theme)).toBe(theme)
  })

  it.each([
    [true, 'DARK'],
    [false, 'LIGHT'],
  ])('resolves SYSTEM via the OS preference (prefers dark: %s → %s)', (prefersDark, expected) => {
    mockOsTheme(prefersDark)
    expect(resolveTheme('SYSTEM')).toBe(expected)
  })
})

describe('resolveTheme without matchMedia', () => {
  it('assumes a dark OS when the browser cannot tell', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('SYSTEM')).toBe('DARK')
  })
})

describe('applyTheme', () => {
  it.each([
    ['DARK', 'dark', 'light'],
    ['LIGHT', 'light', 'dark'],
  ] as const)('sets only the matching class for an explicit %s preference', (theme, set, unset) => {
    applyTheme(theme)
    expect(document.documentElement.classList.contains(set)).toBe(true)
    expect(document.documentElement.classList.contains(unset)).toBe(false)
  })

  it('resolves SYSTEM via prefers-color-scheme', () => {
    mockOsTheme(false)
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
