import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, readStoredTheme, resolveTheme, writeStoredTheme } from '../theme'

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
