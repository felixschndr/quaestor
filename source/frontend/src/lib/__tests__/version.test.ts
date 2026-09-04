import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOUR_MS = 60 * 60 * 1000

function installServiceWorker(update: () => Promise<void>): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { getRegistration: async () => ({ update }) },
    configurable: true,
  })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
}

async function loadCheckForFrontendUpdate() {
  vi.resetModules()
  return (await import('@/lib/version')).checkForFrontendUpdate
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })
})

describe('checkForFrontendUpdate', () => {
  it('asks the service worker for a new build', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    installServiceWorker(update)

    await (
      await loadCheckForFrontendUpdate()
    )()

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('checks at most once an hour', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    installServiceWorker(update)
    const checkForFrontendUpdate = await loadCheckForFrontendUpdate()

    await checkForFrontendUpdate()
    vi.setSystemTime(Date.now() + HOUR_MS / 2)
    await checkForFrontendUpdate()
    expect(update).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + HOUR_MS)
    await checkForFrontendUpdate()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('retries right away after a failed check instead of waiting an hour', async () => {
    const update = vi.fn().mockRejectedValue(new Error('backend restarting'))
    installServiceWorker(update)
    const checkForFrontendUpdate = await loadCheckForFrontendUpdate()

    await checkForFrontendUpdate()
    await checkForFrontendUpdate()

    expect(update).toHaveBeenCalledTimes(2)
  })

  it('does nothing while offline', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    installServiceWorker(update)
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    await (
      await loadCheckForFrontendUpdate()
    )()

    expect(update).not.toHaveBeenCalled()
  })
})
