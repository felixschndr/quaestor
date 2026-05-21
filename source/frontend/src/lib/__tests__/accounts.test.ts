import { describe, expect, it } from 'vitest'

import { bankIconUrl, displayNameOrUserName, groupAccountsByBank } from '@/lib/accounts'
import type { CredentialRead } from '@/lib/auth'

function makeCredential(
  bank: string,
  accounts: { id: number; name: string; balance?: number }[],
): CredentialRead {
  return {
    id: bank.charCodeAt(0),
    bank,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      balance: a.balance ?? 0,
      balance_factor: 100,
    })),
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
  }
}

describe('groupAccountsByBank', () => {
  it('returns an empty list when there are no credentials', () => {
    expect(groupAccountsByBank([])).toEqual([])
  })

  it('sorts banks alphabetically', () => {
    const groups = groupAccountsByBank([
      makeCredential('trade_republic', [{ id: 1, name: 'TR Cash' }]),
      makeCredential('ing', [{ id: 2, name: 'ING Giro' }]),
      makeCredential('dkb', [{ id: 3, name: 'DKB Visa' }]),
    ])
    expect(groups.map((g) => g.bank)).toEqual(['dkb', 'ing', 'trade_republic'])
  })

  it('sorts accounts alphabetically within each bank', () => {
    const groups = groupAccountsByBank([
      makeCredential('ing', [
        { id: 1, name: 'Tagesgeld' },
        { id: 2, name: 'Girokonto' },
        { id: 3, name: 'Extra-Konto' },
      ]),
    ])
    expect(groups[0].accounts.map((a) => a.name)).toEqual(['Extra-Konto', 'Girokonto', 'Tagesgeld'])
  })

  it('merges multiple credentials for the same bank into one group', () => {
    const groups = groupAccountsByBank([
      makeCredential('ing', [{ id: 1, name: 'Account A' }]),
      makeCredential('ing', [{ id: 2, name: 'Account B' }]),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].accounts.map((a) => a.id)).toEqual([1, 2])
  })
})

describe('displayNameOrUserName', () => {
  it('uses display_name when present', () => {
    expect(displayNameOrUserName({ display_name: 'Alice', user_name: 'alice' })).toBe('Alice')
  })

  it('falls back to user_name when display_name is empty or whitespace', () => {
    expect(displayNameOrUserName({ display_name: '', user_name: 'alice' })).toBe('alice')
    expect(displayNameOrUserName({ display_name: '   ', user_name: 'alice' })).toBe('alice')
  })
})

describe('bankIconUrl', () => {
  it('builds the static path expected by the FastAPI mount', () => {
    expect(bankIconUrl('ing')).toBe('/static/banks/ing.png')
    expect(bankIconUrl('trade_republic')).toBe('/static/banks/trade_republic.png')
  })
})
