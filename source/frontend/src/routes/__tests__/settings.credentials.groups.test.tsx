import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
}))

import { __testing } from '@/routes/settings.credentials.groups'
import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { UserRead } from '@/lib/auth'

const {
  moveAccount,
  moveGroup,
  parseTargetContainer,
  toWritePayload,
  sameLayout,
  buildAccountLookup,
  shouldInsertAfter,
} = __testing

function buildUser(): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    theme: 'SYSTEM',
    balance: 0,
    credentials: [
      {
        id: 10,
        bank: 'ing',
        accounts: [
          {
            id: 1,
            name: 'Giro',
            display_name: null,
            balance: 100,
            balance_factor: 100,
            is_hidden: false,
          },
          {
            id: 2,
            name: 'Tagesgeld',
            display_name: null,
            balance: 200,
            balance_factor: 100,
            is_hidden: false,
          },
        ],
        last_fetching_timestamp: null,
        requires_two_factor_authentication: false,
      },
    ],
  }
}

const sampleLayout: AccountGroupLayout = {
  groups: [
    { id: 100, name: 'Spar', accounts: [{ id: 1 }] },
    { id: 200, name: 'Daily', accounts: [{ id: 2 }] },
  ],
  ungrouped: [],
}

describe('moveAccount', () => {
  it('moves an account from one group to another', () => {
    const next = moveAccount(sampleLayout, 1, 'container-200')
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([])
    expect(next.groups[1].accounts.map((a) => a.id)).toEqual([2, 1])
  })

  it('moves an account from a group to the ungrouped bucket', () => {
    const next = moveAccount(sampleLayout, 1, 'container-ungrouped')
    expect(next.groups[0].accounts).toEqual([])
    expect(next.ungrouped.map((a) => a.id)).toEqual([1])
  })

  it('reorders within the same group by inserting before the hovered account', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
      ungrouped: [],
    }
    // Move 30 onto 10 → 30 lands before 10.
    const next = moveAccount(layout, 30, 'account-10')
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([30, 10, 20])
  })

  it('inserts after the hovered account when insertAfter is true', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
      ungrouped: [{ id: 40 }],
    }
    // Drop 40 onto 30 with cursor in 30's lower half → 40 lands at the very end.
    const next = moveAccount(layout, 40, 'account-30', true)
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([10, 20, 30, 40])
    expect(next.ungrouped).toEqual([])
  })

  it('returns the layout unchanged when the drop target is unknown', () => {
    expect(moveAccount(sampleLayout, 1, 'mystery-target')).toBe(sampleLayout)
  })
})

describe('parseTargetContainer', () => {
  it('resolves container drops directly', () => {
    expect(parseTargetContainer('container-200', sampleLayout)).toBe(200)
    expect(parseTargetContainer('container-ungrouped', sampleLayout)).toBe('ungrouped')
  })

  it('resolves item drops to their owning container', () => {
    expect(parseTargetContainer('account-1', sampleLayout)).toBe(100)
    expect(parseTargetContainer('account-2', sampleLayout)).toBe(200)
  })

  it('returns null for unknown drop ids', () => {
    expect(parseTargetContainer('unknown', sampleLayout)).toBeNull()
  })
})

describe('toWritePayload', () => {
  it('keeps positive group ids and drops placeholder negative ids', () => {
    const layout: AccountGroupLayout = {
      groups: [
        { id: 100, name: 'Existing', accounts: [{ id: 1 }] },
        { id: -42, name: 'Placeholder', accounts: [{ id: 2 }] },
      ],
      ungrouped: [{ id: 3 }],
    }
    const payload = toWritePayload(layout)
    expect(payload.groups[0]).toEqual({ id: 100, name: 'Existing', account_ids: [1] })
    // No id on the placeholder — the server will assign one.
    expect(payload.groups[1]).toEqual({ name: 'Placeholder', account_ids: [2] })
    expect(payload.ungrouped).toEqual([3])
  })

  it('falls back to a default name when the user empties the input', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: -1, name: '   ', accounts: [] }],
      ungrouped: [],
    }
    expect(toWritePayload(layout).groups[0].name).toBe('Group')
  })
})

describe('sameLayout', () => {
  it('returns true for layouts that match group-by-group and account-by-account', () => {
    const a: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [{ id: 20 }],
    }
    const b: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [{ id: 20 }],
    }
    expect(sameLayout(a, b)).toBe(true)
  })

  it('detects renames, reorders and reassignments as different', () => {
    const base: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [],
    }
    expect(sameLayout(base, { ...base, groups: [{ ...base.groups[0], name: 'Renamed' }] })).toBe(
      false,
    )
    expect(
      sameLayout(base, {
        ...base,
        groups: [{ ...base.groups[0], accounts: [{ id: 10 }, { id: 11 }] }],
      }),
    ).toBe(false)
  })
})

describe('moveGroup', () => {
  const threeGroups: AccountGroupLayout = {
    groups: [
      { id: 1, name: 'A', accounts: [] },
      { id: 2, name: 'B', accounts: [] },
      { id: 3, name: 'C', accounts: [] },
    ],
    ungrouped: [],
  }

  it('moves the first group to the end', () => {
    const next = moveGroup(threeGroups, 1, 3)
    expect(next.groups.map((g) => g.id)).toEqual([2, 3, 1])
  })

  it('moves the last group to the start', () => {
    const next = moveGroup(threeGroups, 3, 1)
    expect(next.groups.map((g) => g.id)).toEqual([3, 1, 2])
  })

  it('preserves account assignments while moving', () => {
    const layout: AccountGroupLayout = {
      groups: [
        { id: 1, name: 'A', accounts: [{ id: 10 }] },
        { id: 2, name: 'B', accounts: [{ id: 20 }, { id: 21 }] },
      ],
      ungrouped: [{ id: 99 }],
    }
    const next = moveGroup(layout, 1, 2)
    expect(next.groups.map((g) => g.id)).toEqual([2, 1])
    expect(next.groups[1].accounts.map((a) => a.id)).toEqual([10])
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([20, 21])
    expect(next.ungrouped).toEqual([{ id: 99 }])
  })

  it('returns the layout unchanged when from === to or ids are unknown', () => {
    expect(moveGroup(threeGroups, 1, 1)).toBe(threeGroups)
    expect(moveGroup(threeGroups, 99, 1)).toBe(threeGroups)
    expect(moveGroup(threeGroups, 1, 99)).toBe(threeGroups)
  })
})

describe('shouldInsertAfter', () => {
  const overItem = { id: 'account-10', rect: { top: 100, height: 40 } }
  // over midpoint = 120

  it('returns true when the dragged item is past the over item midpoint', () => {
    const active = { rect: { current: { translated: { top: 110, height: 40 } } } }
    // active midpoint = 130 > 120
    expect(shouldInsertAfter(active, overItem)).toBe(true)
  })

  it('returns false when the dragged item sits above the over item midpoint', () => {
    const active = { rect: { current: { translated: { top: 80, height: 40 } } } }
    // active midpoint = 100 < 120
    expect(shouldInsertAfter(active, overItem)).toBe(false)
  })

  it('returns false when dropping on a container (not an account item)', () => {
    const active = { rect: { current: { translated: { top: 500, height: 40 } } } }
    const overContainer = { id: 'container-200', rect: { top: 100, height: 40 } }
    expect(shouldInsertAfter(active, overContainer)).toBe(false)
  })
})

describe('buildAccountLookup', () => {
  it('flattens accounts across credentials and tags each with its bank', () => {
    const lookup = buildAccountLookup(buildUser())
    expect(lookup.get(1)?.bank).toBe('ing')
    expect(lookup.get(2)?.name).toBe('Tagesgeld')
    expect(lookup.size).toBe(2)
  })

  it('returns an empty map when the user is missing', () => {
    expect(buildAccountLookup(undefined).size).toBe(0)
  })
})
