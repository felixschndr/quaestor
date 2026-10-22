import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { autoSubscribe, sendTestNotification } from '../push'
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(autoSubscribe()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith('Push auto-subscribe failed', expect.any(Error))
  })

  it('does nothing without push support (plain http)', async () => {
    await autoSubscribe()

    expect(api).not.toHaveBeenCalled()
  })
})

describe('sendTestNotification', () => {
  it('reports an unsupported device without asking for permission', async () => {
    await expect(sendTestNotification()).resolves.toEqual({ status: 'unsupported' })

    expect(api).not.toHaveBeenCalled()
  })

  it('reports a denied permission and sends nothing', async () => {
    const { requestPermission } = installPushEnv('default', null)
    requestPermission.mockResolvedValue('denied')

    await expect(sendTestNotification()).resolves.toEqual({ status: 'denied' })

    expect(api).not.toHaveBeenCalled()
  })

  it('re-registers the existing subscription and returns the delivery counts', async () => {
    const { subscribe } = installPushEnv('granted', subscription)
    vi.mocked(api).mockImplementation(async (path) =>
      path === '/push/test' ? { sent: 2, failed: 1, error: null } : undefined,
    )

    await expect(sendTestNotification()).resolves.toEqual({
      status: 'done',
      sent: 2,
      failed: 1,
      error: null,
    })

    expect(subscribe).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalledWith('/push/public-key')
    expect(api).toHaveBeenCalledWith('/push/subscribe', {
      method: 'POST',
      body: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
    })
  })

  it('subscribes with the url-safe base64 server key decoded to bytes', async () => {
    const { subscribe } = installPushEnv('granted', null)
    vi.mocked(api).mockImplementation(async (path) =>
      path === '/push/public-key' ? { public_key: '-_8' } : { sent: 1, failed: 0 },
    )

    await sendTestNotification()

    const { applicationServerKey } = subscribe.mock.calls[0][0]
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect([...applicationServerKey]).toEqual([0xfb, 0xff])
  })

  it('lets subscription errors reach the caller', async () => {
    installPushEnv('granted', null)
    vi.mocked(api).mockRejectedValue(new Error('offline'))

    await expect(sendTestNotification()).rejects.toThrow('offline')
  })
})
