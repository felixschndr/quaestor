import { ApiError } from './api'

/**
 * Turns an unknown thrown value into a user-facing, translated error message.
 * Surfaces the backend's 422 validation detail when present, maps rate limiting
 * to a dedicated message, and otherwise falls back to a generic error.
 */
export function readApiErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 422 && err.body && typeof err.body === 'object') {
      const detail = (err.body as { detail?: unknown }).detail
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0]
        if (first && typeof first === 'object' && 'msg' in first) {
          return String((first as { msg: unknown }).msg)
        }
      }
      if (typeof detail === 'string') return detail
    }
    if (err.status === 429) return t('login.rateLimited')
  }
  return t('login.genericError')
}
