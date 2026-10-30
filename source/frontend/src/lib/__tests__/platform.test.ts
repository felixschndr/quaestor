import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectPlatform, isStandalone } from '@/lib/platform'

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'

function fakeDevice({
  userAgent,
  platform = '',
  maxTouchPoints = 0,
}: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as { standalone?: boolean }).standalone
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints
})

describe('detectPlatform', () => {
  it.each([
    ['an iPhone', { userAgent: IPHONE_UA }, 'ios'],
    [
      'an iPad posing as a Mac',
      { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 5 },
      'ios',
    ],
    ['an Android phone', { userAgent: ANDROID_UA }, 'android'],
    [
      'a Mac without touch',
      { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 },
      'desktop',
    ],
  ] as const)('recognises %s', (_, device, expected) => {
    fakeDevice(device)

    expect(detectPlatform()).toBe(expected)
  })

  it('falls back to desktop outside a browser', () => {
    vi.stubGlobal('navigator', undefined)

    expect(detectPlatform()).toBe('desktop')
  })
})

describe('isStandalone', () => {
  it('is false in a normal browser tab', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))

    expect(isStandalone()).toBe(false)
  })

  it('is true when the installed app runs in standalone display mode', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', matchMedia)

    expect(isStandalone()).toBe(true)
    expect(matchMedia).toHaveBeenCalledWith('(display-mode: standalone)')
  })

  it('is true for an iOS home-screen app even without matchMedia', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })

    expect(isStandalone()).toBe(true)
  })

  it('is false outside a browser', () => {
    vi.stubGlobal('window', undefined)

    expect(isStandalone()).toBe(false)
  })
})
