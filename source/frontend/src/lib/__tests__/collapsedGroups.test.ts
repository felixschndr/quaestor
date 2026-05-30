import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { STORAGE_KEY, readCollapsed, useCollapsedGroups, writeCollapsed } from '../collapsedGroups'

beforeEach(() => {
  window.localStorage.clear()
})

describe('readCollapsed / writeCollapsed', () => {
  it('returns an empty set when nothing is stored', () => {
    expect(readCollapsed().size).toBe(0)
  })

  it('round-trips stored keys', () => {
    writeCollapsed(new Set(['group-1', 'ungrouped']))
    const stored = readCollapsed()
    expect(stored.has('group-1')).toBe(true)
    expect(stored.has('ungrouped')).toBe(true)
    expect(stored.size).toBe(2)
  })

  it('falls back to an empty set on malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json')
    expect(readCollapsed().size).toBe(0)
  })

  it('falls back to an empty set when the stored value is not an array of strings', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }))
    expect(readCollapsed().size).toBe(0)
  })
})

describe('useCollapsedGroups', () => {
  it('treats an unknown key as expanded by default', () => {
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('group-1')).toBe(false)
  })

  it('seeds the collapsed state from localStorage', () => {
    writeCollapsed(new Set(['group-7']))
    const { result } = renderHook(() => useCollapsedGroups())
    expect(result.current.isCollapsed('group-7')).toBe(true)
  })

  it('toggles a key and persists it to localStorage', () => {
    const { result } = renderHook(() => useCollapsedGroups())

    act(() => result.current.toggle('group-3'))
    expect(result.current.isCollapsed('group-3')).toBe(true)
    expect(readCollapsed().has('group-3')).toBe(true)

    act(() => result.current.toggle('group-3'))
    expect(result.current.isCollapsed('group-3')).toBe(false)
    expect(readCollapsed().has('group-3')).toBe(false)
  })
})
