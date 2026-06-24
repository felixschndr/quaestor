import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
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
  include_content: boolean
  name: string | null
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

const BASE_PATH = '/notification_rules'

function listRules(): Promise<NotificationRule[]> {
  return api<NotificationRule[]>(BASE_PATH)
}

function createRule(draft: NotificationRuleDraft): Promise<NotificationRule> {
  return api<NotificationRule>(BASE_PATH, { method: 'POST', body: draft })
}

function updateRule(id: number, draft: NotificationRuleDraft): Promise<NotificationRule> {
  return api<NotificationRule>(`${BASE_PATH}/${id}`, { method: 'PUT', body: draft })
}

function removeRule(id: number): Promise<void> {
  return api<void>(`${BASE_PATH}/${id}`, { method: 'DELETE' })
}

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
