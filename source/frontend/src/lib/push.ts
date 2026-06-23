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

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  // applicationServerKey must be a raw byte array; the backend sends it base64url-encoded.
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

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
      applicationServerKey: urlBase64ToUint8Array(public_key),
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
