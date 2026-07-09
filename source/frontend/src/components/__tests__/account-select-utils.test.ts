import { describe, expect, it } from 'vitest'

import { groupAccountsByBank } from '@/components/ui/account-select-utils'
import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { AccountRead, CredentialRead } from '@/lib/auth'

function account(id: number, name: string): AccountRead {
  return { id, name, display_name: null, balance: 0, balance_factor: 100, is_hidden: false }
}

const credentials: CredentialRead[] = [
  {
    id: 1,
    bank: 'ing',
    bank_name: 'ING',
    bank_icon: null,
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
    accounts: [account(1, 'Girokonto'), account(2, 'Extra-Konto')],
  },
  {
    id: 2,
    bank: 'dkb',
    bank_name: 'DKB',
    bank_icon: null,
    last_fetching_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
    accounts: [account(3, 'Depot')],
  },
]

const flatIds = (groups: ReturnType<typeof groupAccountsByBank>) =>
  groups.flatMap((group) => group.accounts.map((entry) => entry.id))

describe('groupAccountsByBank', () => {
  it('sorts banks and accounts alphabetically without a custom layout', () => {
    const groups = groupAccountsByBank(credentials)

    expect(groups.map((group) => group.name)).toEqual(['DKB', 'ING'])
    expect(flatIds(groups)).toEqual([3, 2, 1])
  })

  it('orders accounts like the overview when a custom layout exists', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 7, name: 'Alltag', accounts: [{ id: 1 }, { id: 3 }] }],
      ungrouped: [{ id: 2 }],
    }

    const groups = groupAccountsByBank(credentials, layout)

    expect(groups.map((group) => group.name)).toEqual(['ING', 'DKB'])
    expect(flatIds(groups)).toEqual([1, 2, 3])
  })

  it('ignores an empty layout', () => {
    const layout: AccountGroupLayout = { groups: [], ungrouped: [{ id: 2 }] }

    expect(flatIds(groupAccountsByBank(credentials, layout))).toEqual([3, 2, 1])
  })
})
