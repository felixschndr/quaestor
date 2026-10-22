import { describe, expect, it } from 'vitest'

import { deviceCodeFromAuthorizationUrl } from '@/lib/credentials'
import { AUTHORIZATION_URL, AUTHORIZATION_URL_WITH_CODE, DEVICE_CODE } from '@/test/constants'

describe('deviceCodeFromAuthorizationUrl', () => {
  it('reads the user_code query parameter', () => {
    expect(deviceCodeFromAuthorizationUrl(AUTHORIZATION_URL_WITH_CODE)).toBe(DEVICE_CODE)
  })

  it.each([
    ['a URL without user_code', AUTHORIZATION_URL],
    ['a missing URL', null],
    ['an unparsable URL', 'not a url'],
  ])('returns null for %s', (_label, url) => {
    expect(deviceCodeFromAuthorizationUrl(url)).toBeNull()
  })
})
