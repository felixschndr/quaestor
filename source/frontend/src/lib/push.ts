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

export async function autoSubscribe(): Promise<void> {
  if (!pushSupported()) return
  try {
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
    if (permission !== 'granted') return

    const registration = await navigator.serviceWorker.ready
    if (await registration.pushManager.getSubscription()) return

    await ensureSubscription()
    await api('/push/test', { method: 'POST' })
  } catch (err) {
    console.warn('Push auto-subscribe failed', err)
  }
}

export async function sendTestNotification(): Promise<TestOutcome> {
  if (!pushSupported()) return { status: 'unsupported' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { status: 'denied' }

  await ensureSubscription()
  const result = await api<TestResult>('/push/test', { method: 'POST' })
  return { status: 'done', ...result }
}
