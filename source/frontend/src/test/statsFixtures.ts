import type { AccountRead, CredentialRead } from '@/lib/auth'

export function buildAccount(overrides: Partial<AccountRead> & Pick<AccountRead, 'id' | 'name'>) {
  return {
    display_name: null,
    balance: 0,
    balance_factor: 100,
    is_hidden: false,
    include_by_default: true,
    is_market_valued: false,
    ...overrides,
  } satisfies AccountRead
}

export function buildCredential(
  accounts: AccountRead[],
  overrides: Partial<CredentialRead> = {},
): CredentialRead {
  return {
    id: 1,
    bank: 'ing',
    bank_name: null,
    bank_icon: null,
    accounts,
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: false,
    ...overrides,
  }
}
