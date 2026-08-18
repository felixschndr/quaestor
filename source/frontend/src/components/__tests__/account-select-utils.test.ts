import { describe, expect, it } from 'vitest'

import { groupAccounts } from '@/components/ui/account-select-utils'
import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { AccountRead, CredentialRead } from '@/lib/auth'
import { ACCOUNT_NAME_GIRO } from '@/test/constants'

function account(id: number, name: string): AccountRead {
  return {
    id,
    name,
    display_name: null,
    balance: 0,
    balance_factor: 100,
    is_hidden: false,
    include_by_default: true,
    is_market_valued: false,
  }
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
    accounts: [account(1, ACCOUNT_NAME_GIRO), account(2, 'Extra Account')],
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

const flatIds = (groups: ReturnType<typeof groupAccounts>) =>
  groups.flatMap((group) => group.accounts.map((entry) => entry.id))

describe('groupAccounts', () => {
  it('groups by bank without headings, sorted alphabetically, when no custom layout exists', () => {
    const groups = groupAccounts(credentials)

    expect(groups.map((group) => group.heading)).toEqual([null, null])
    expect(groups.map((group) => group.key)).toEqual(['cred-2', 'cred-1'])
    expect(flatIds(groups)).toEqual([3, 2, 1])
  })

  it('carries the owning bank on every account row', () => {
    const [dkb] = groupAccounts(credentials)

    expect(dkb.accounts[0]).toMatchObject({ id: 3, bankName: 'DKB', bankIcon: null })
  })

  it('mirrors the overview: one labelled section per custom group plus ungrouped', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 7, name: 'Alltag', accounts: [{ id: 1 }, { id: 3 }] }],
      ungrouped: [{ id: 2 }],
    }

    const groups = groupAccounts(credentials, layout)

    expect(groups.map((group) => group.heading)).toEqual(['Alltag', '__ungrouped__'])
    expect(flatIds(groups)).toEqual([1, 3, 2])
  })

  it('folds accounts the layout never references into the ungrouped section', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 7, name: 'Alltag', accounts: [{ id: 1 }] }],
      ungrouped: [],
    }

    const groups = groupAccounts(credentials, layout)

    expect(groups.map((group) => group.heading)).toEqual(['Alltag', '__ungrouped__'])
    expect(flatIds(groups)).toEqual([1, 2, 3])
  })

  it('treats an empty custom layout as no layout', () => {
    const layout: AccountGroupLayout = { groups: [], ungrouped: [{ id: 2 }] }

    expect(groupAccounts(credentials, layout).map((group) => group.heading)).toEqual([null, null])
    expect(flatIds(groupAccounts(credentials, layout))).toEqual([3, 2, 1])
  })
})
