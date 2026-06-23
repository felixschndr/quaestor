import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TransactionCategory, TransactionType } from './transaction'

export const NOTIFICATION_TRIGGERS = [
  'expected_transaction',
  'transaction',
  'balance_below',
] as const
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number]

interface RuleBase {
  id: number
  enabled: boolean
  // Optional user-given label; falls back to the trigger description when empty.
  name: string | null
  // Accounts the rule applies to (at least one; selecting every account means "all").
  account_ids: number[]
}

export interface ExpectedTransactionRule extends RuleBase {
  trigger: 'expected_transaction'
}

export interface TransactionRule extends RuleBase {
  trigger: 'transaction'
  other_party_contains: string | null
  categories: TransactionCategory[]
  types: TransactionType[]
  min_amount: number | null
  max_amount: number | null
}

export interface BalanceBelowRule extends RuleBase {
  trigger: 'balance_below'
  threshold: number
}

export type NotificationRule = ExpectedTransactionRule | TransactionRule | BalanceBelowRule
export type NotificationRuleDraft =
  | Omit<ExpectedTransactionRule, 'id'>
  | Omit<TransactionRule, 'id'>
  | Omit<BalanceBelowRule, 'id'>

/**
 * A stable key for a rule's *meaning* (trigger + criteria), ignoring id and the
 * enabled flag. Used to detect "exactly the same rule already exists".
 */
export function ruleSignature(rule: NotificationRule | NotificationRuleDraft): string {
  const accounts = [...rule.account_ids].sort((a, b) => a - b)
  if (rule.trigger === 'transaction') {
    return JSON.stringify({
      trigger: rule.trigger,
      accounts,
      other_party_contains: rule.other_party_contains ?? null,
      categories: [...rule.categories].sort(),
      types: [...rule.types].sort(),
      min_amount: rule.min_amount ?? null,
      max_amount: rule.max_amount ?? null,
    })
  }
  if (rule.trigger === 'balance_below') {
    return JSON.stringify({ trigger: rule.trigger, accounts, threshold: rule.threshold })
  }
  return JSON.stringify({ trigger: rule.trigger, accounts })
}

/* -------------------------------------------------------------------------- */
/* MOCK STORE                                                                 */
/* The notification-rule backend does not exist yet. To let the UI be         */
/* reviewed end-to-end, rules are persisted in localStorage. Once the backend */
/* lands, replace each function body with the matching `api(...)` call — the   */
/* hooks and types below stay exactly the same.                               */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'quaestor.notificationRules.mock'

function readStore(): NotificationRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as NotificationRule[]) : []
  } catch {
    return []
  }
}

function writeStore(rules: NotificationRule[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}

async function listRules(): Promise<NotificationRule[]> {
  return readStore()
}

async function createRule(draft: NotificationRuleDraft): Promise<NotificationRule> {
  const rules = readStore()
  const nextId = rules.reduce((max, rule) => Math.max(max, rule.id), 0) + 1
  const created = { ...draft, id: nextId } as NotificationRule
  writeStore([...rules, created])
  return created
}

async function updateRule(id: number, draft: NotificationRuleDraft): Promise<NotificationRule> {
  const rules = readStore()
  const updated = { ...draft, id } as NotificationRule
  writeStore(rules.map((rule) => (rule.id === id ? updated : rule)))
  return updated
}

async function removeRule(id: number): Promise<void> {
  writeStore(readStore().filter((rule) => rule.id !== id))
}

/* -------------------------------------------------------------------------- */

export const notificationRuleQueryKeys = {
  list: ['notification-rules'] as const,
}

export function useNotificationRules() {
  return useQuery({
    queryKey: notificationRuleQueryKeys.list,
    queryFn: listRules,
  })
}

export function useCreateNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: NotificationRuleDraft) => createRule(draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}

export function useUpdateNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: NotificationRuleDraft }) =>
      updateRule(id, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}

export function useDeleteNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => removeRule(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}
