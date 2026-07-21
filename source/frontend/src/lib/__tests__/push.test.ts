import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { autoSubscribe } from '../push'
import { api } from '../api'

vi.mock('../api', () => ({ api: vi.fn() }))

const subscription = {
  toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
}

function installPushEnv(permission: NotificationPermission, existingSubscription: unknown) {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  const subscribe = vi.fn().mockResolvedValue(subscription)
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: vi.fn().mockResolvedValue(existingSubscription),
          subscribe,
        },
      }),
    },
    configurable: true,
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { permission, requestPermission })
  return { requestPermission, subscribe }
}

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ public_key: 'a2V5' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })
})

describe('autoSubscribe', () => {
  it('stays silent when this device is already subscribed', async () => {
    const { requestPermission, subscribe } = installPushEnv('granted', subscription)

    await autoSubscribe()

    expect(requestPermission).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('asks for permission, subscribes and sends a test push for a new device', async () => {
    const { requestPermission, subscribe } = installPushEnv('default', null)

    await autoSubscribe()

    expect(requestPermission).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
    expect(api).toHaveBeenCalledWith('/push/subscribe', expect.anything())
    expect(api).toHaveBeenCalledWith('/push/test', { method: 'POST' })
  })

  it('stays quiet when permission was denied', async () => {
    installPushEnv('denied', null)

    await autoSubscribe()

    expect(api).not.toHaveBeenCalled()
  })

  it('swallows errors (e.g. no user gesture, offline)', async () => {
    installPushEnv('granted', null)
    vi.mocked(api).mockRejectedValue(new Error('offline'))

    await expect(autoSubscribe()).resolves.toBeUndefined()
  })

  it('does nothing without push support (plain http)', async () => {
    await autoSubscribe()

    expect(api).not.toHaveBeenCalled()
  })
})
