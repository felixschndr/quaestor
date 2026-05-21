const CSRF_COOKIE_NAME = 'csrf_token'

export function readCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]) : null
}
