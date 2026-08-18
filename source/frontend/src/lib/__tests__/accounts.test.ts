import { describe, expect, it } from 'vitest'

import { accountDisplayName, accountSecondaryName, displayNameOrUserName } from '@/lib/accounts'
import {
  ACCOUNT_NAME_CHECKING,
  LABEL_SALARY,
  LABEL_SAVINGS,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
} from '@/test/constants'

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
    expect(accountDisplayName({ name: TEST_IBAN, display_name: ACCOUNT_NAME_CHECKING })).toBe(
      ACCOUNT_NAME_CHECKING,
    )
  })

  it('falls back to the formatted IBAN when display_name is null', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: null })).toBe(TEST_IBAN_FORMATTED)
  })

  it('treats a whitespace-only display_name as unset', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: '   ' })).toBe(TEST_IBAN_FORMATTED)
  })

  it('trims the display_name before returning it', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: `  ${LABEL_SAVINGS}  ` })).toBe(
      LABEL_SAVINGS,
    )
  })
})

describe('accountSecondaryName', () => {
  it('returns null when no personalised name is set (the IBAN is already the primary label)', () => {
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: null })).toBeNull()
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: '  ' })).toBeNull()
  })

  it('returns the formatted IBAN when a personalised name is set', () => {
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: LABEL_SALARY })).toBe(
      TEST_IBAN_FORMATTED,
    )
  })
})
