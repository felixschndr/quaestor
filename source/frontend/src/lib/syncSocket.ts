/**
 * Builds the WebSocket URL for streaming a credential's sync job progress.
 *
 * `credentialId` and `jobId` flow in from server responses, so each is
 * percent-encoded to confine it to a single path segment — without this an
 * attacker-influenced value could inject extra path/host separators and point
 * the connection elsewhere (request forgery).
 */
export function syncJobWebSocketUrl(credentialId: number, jobId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const id = encodeURIComponent(credentialId)
  const job = encodeURIComponent(jobId)
  return `${scheme}://${window.location.host}/api/credentials/${id}/sync/${job}/ws`
}
