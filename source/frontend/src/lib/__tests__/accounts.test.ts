import { describe, expect, it } from 'vitest'

import { accountDisplayName, accountSecondaryName, displayNameOrUserName } from '@/lib/accounts'

describe('displayNameOrUserName', () => {
  it('uses display_name when present', () => {
    expect(displayNameOrUserName({ display_name: 'Alice', user_name: 'alice' })).toBe('Alice')
  })

  it('falls back to user_name when display_name is empty or whitespace', () => {
    expect(displayNameOrUserName({ display_name: '', user_name: 'alice' })).toBe('alice')
    expect(displayNameOrUserName({ display_name: '   ', user_name: 'alice' })).toBe('alice')
  })
})

describe('accountDisplayName', () => {
  it('returns the display_name when present', () => {
    expect(accountDisplayName({ name: 'DE12345678900001', display_name: 'Gehaltskonto' })).toBe(
      'Gehaltskonto',
    )
  })

  it('falls back to the formatted IBAN when display_name is null', () => {
    expect(accountDisplayName({ name: 'DE12345678900001', display_name: null })).toBe(
      'DE12 3456 7890 0001',
    )
  })

  it('treats a whitespace-only display_name as unset', () => {
    expect(accountDisplayName({ name: 'DE12345678900001', display_name: '   ' })).toBe(
      'DE12 3456 7890 0001',
    )
  })

  it('trims the display_name before returning it', () => {
    expect(accountDisplayName({ name: 'DE12345678900001', display_name: '  Sparbuch  ' })).toBe(
      'Sparbuch',
    )
  })
})

describe('accountSecondaryName', () => {
  it('returns null when no personalised name is set (the IBAN is already the primary label)', () => {
    expect(accountSecondaryName({ name: 'DE12345678900001', display_name: null })).toBeNull()
    expect(accountSecondaryName({ name: 'DE12345678900001', display_name: '  ' })).toBeNull()
  })

  it('returns the formatted IBAN when a personalised name is set', () => {
    expect(accountSecondaryName({ name: 'DE12345678900001', display_name: 'Gehalt' })).toBe(
      'DE12 3456 7890 0001',
    )
  })
})
