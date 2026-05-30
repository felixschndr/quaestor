import { afterEach, describe, expect, it } from 'vitest'

import { syncJobWebSocketUrl } from '../syncSocket'

const originalLocation = window.location

function setLocation(protocol: string, host: string) {
  Object.defineProperty(window, 'location', {
    value: { protocol, host },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    configurable: true,
    writable: true,
  })
})

describe('syncJobWebSocketUrl', () => {
  it('builds a ws:// URL on plain HTTP', () => {
    setLocation('http:', 'localhost:8000')
    expect(syncJobWebSocketUrl(5, 'abc-123')).toBe(
      'ws://localhost:8000/api/credentials/5/sync/abc-123/ws',
    )
  })

  it('builds a wss:// URL on HTTPS', () => {
    setLocation('https:', 'app.example.com')
    expect(syncJobWebSocketUrl(5, 'abc-123')).toBe(
      'wss://app.example.com/api/credentials/5/sync/abc-123/ws',
    )
  })

  it('percent-encodes the job id so it cannot break out of its path segment', () => {
    setLocation('http:', 'localhost')
    const url = syncJobWebSocketUrl(5, '../../evil?x=1')
    // The host stays localhost and the job id is confined to one path segment:
    // no raw slashes, question marks, or other separators leak through.
    expect(url).toBe('ws://localhost/api/credentials/5/sync/..%2F..%2Fevil%3Fx%3D1/ws')
  })
})
