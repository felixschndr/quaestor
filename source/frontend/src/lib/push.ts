import { api } from './api'

interface PublicKeyResponse {
  public_key: string
}

interface TestResult {
  sent: number
  failed: number
  error?: string | null
}

export type TestOutcome =
  | { status: 'unsupported' }
  | { status: 'denied' }
  | { status: 'done'; sent: number; failed: number; error?: string | null }

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Register this device's push subscription with the backend (idempotent). */
async function ensureSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const { public_key } = await api<PublicKeyResponse>('/push/public-key')
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.fromBase64(public_key, { alphabet: 'base64url' }),
    })
  }

  const json = subscription.toJSON()
  await api('/push/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys },
  })
}

/**
 * Ask for permission (first time), register this device, and have the backend
 * send a test push. Doubles as the "enable notifications on this device" action.
 */
export async function sendTestNotification(): Promise<TestOutcome> {
  if (!pushSupported()) return { status: 'unsupported' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { status: 'denied' }

  await ensureSubscription()
  const result = await api<TestResult>('/push/test', { method: 'POST' })
  return { status: 'done', ...result }
}
