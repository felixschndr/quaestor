import { readCsrfToken } from './csrf'

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * Raised when the backend can't be reached at all — `fetch` itself rejected
 * (typically `TypeError("Failed to fetch")` from CORS, DNS, refused
 * connection, or `navigator.onLine === false`). Distinguished from
 * {@link ApiError} so callers can show an "offline" UI instead of a generic
 * "something went wrong" — the server never had a chance to respond.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause })
    this.name = 'NetworkError'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface RequestOptions {
  method?: Method
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

const MUTATING_METHODS = new Set<Method>(['POST', 'PATCH', 'PUT', 'DELETE'])

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (MUTATING_METHODS.has(method)) {
    const csrf = readCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      signal: options.signal,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch (err) {
    // Preserve AbortError so callers / react-query can detect cancellation.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new NetworkError(err)
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null)

  if (!res.ok) {
    throw new ApiError(res.status, data, `${method} ${url} → ${res.status}`)
  }

  return data as T
}
