import { afterEach, describe, expect, it, vi } from 'vitest'

import { safeStorage } from '@/lib/storage'

const KEY = 'test-key'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('safeStorage', () => {
  it('reads, writes and removes a value in localStorage by default', () => {
    const store = safeStorage(KEY)
    expect(store.read()).toBeNull()

    store.write('on')
    expect(window.localStorage.getItem(KEY)).toBe('on')
    expect(store.read()).toBe('on')

    store.write(null)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps session values out of localStorage', () => {
    const store = safeStorage(KEY, 'session')

    store.write('open')

    expect(window.sessionStorage.getItem(KEY)).toBe('open')
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(store.read()).toBe('open')
  })

  it('treats storage that is blocked (private mode, quota) as empty and ignores writes', () => {
    const blocked = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked)
    const store = safeStorage(KEY, 'session')

    expect(store.read()).toBeNull()
    expect(() => store.write('open')).not.toThrow()
  })
})
