import { describe, expect, it } from 'vitest'

import {
  filterAndSortRules,
  type NotificationRule,
  type NotificationTrigger,
} from '@/lib/notificationRules'

function rule(
  id: number,
  trigger: NotificationTrigger,
  name: string | null,
  account_ids: number[] = [],
): NotificationRule {
  return {
    id,
    trigger,
    name,
    account_ids,
    enabled: true,
    include_content: true,
  } as NotificationRule
}

const labels = {
  trigger: (trigger: NotificationTrigger) => trigger,
  title: (r: NotificationRule) => r.name ?? r.trigger,
}

describe('filterAndSortRules', () => {
  const rules = [
    rule(1, 'transaction', 'Zebra'),
    rule(2, 'digest', 'Bravo', [7]),
    rule(3, 'transaction', 'Alpha', [7]),
    rule(4, 'digest', 'Anton', [9]),
  ]

  it('sorts by trigger then name', () => {
    expect(filterAndSortRules(rules, {}, labels).map((r) => r.id)).toEqual([4, 2, 3, 1])
  })

  it('filters by name, case-insensitively', () => {
    expect(filterAndSortRules(rules, { text: ' alp ' }, labels).map((r) => r.id)).toEqual([3])
  })

  it('filters by trigger', () => {
    expect(filterAndSortRules(rules, { triggers: ['digest'] }, labels).map((r) => r.id)).toEqual([
      4, 2,
    ])
  })

  it('shows nothing when no account is selected', () => {
    expect(filterAndSortRules(rules, { accountIds: [] }, labels)).toEqual([])
  })

  it('filters by account, keeping rules that apply to all accounts', () => {
    expect(filterAndSortRules(rules, { accountIds: [7] }, labels).map((r) => r.id)).toEqual([
      2, 3, 1,
    ])
  })
})
