import type { AccountRead, CredentialRead } from '@/lib/auth'
import type { ContractRead } from '@/lib/contract'
import { AMOUNT_S, CONTRACT_NAME } from '@/test/constants'

export function buildAccount(overrides: Partial<AccountRead> & Pick<AccountRead, 'id' | 'name'>) {
  return {
    display_name: null,
    balance: 0,
    balance_factor: 100,
    is_archived: false,
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
    sync_enabled: true,
    ...overrides,
  }
}

export function buildContract(overrides: Partial<ContractRead> = {}): ContractRead {
  return {
    id: 1,
    account_id: 42,
    name: CONTRACT_NAME,
    note: null,
    category: null,
    source: 'DETECTED',
    median_amount: -AMOUNT_S,
    frequency: 'MONTHLY',
    expected_next_date: null,
    end_date: null,
    is_archived: false,
    is_overdue: false,
    amount_per_day: null,
    amount_per_frequency: null,
    ...overrides,
  }
}
