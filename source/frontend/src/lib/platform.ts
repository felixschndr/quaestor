export type MobilePlatform = 'ios' | 'android' | 'desktop'

export function detectPlatform(): MobilePlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  const isIpadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iphone|ipad|ipod/i.test(ua) || isIpadOs) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

/** True when the app already runs as an installed PWA (standalone display mode). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneDisplay = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return standaloneDisplay || iosStandalone
}
