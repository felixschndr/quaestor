import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import type { TransactionCategory, TransactionType } from './transaction'

export const NOTIFICATION_TRIGGERS = [
  'expected_transaction',
  'contract_overdue',
  'contract_amount_increased',
  'duplicate_transaction',
  'upcoming_shortfall',
  'transaction',
  'balance_threshold',
] as const
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number]

export const TRIGGER_DEFAULT_DAYS = {
  contract_overdue: 5,
  duplicate_transaction: 3,
  upcoming_shortfall: 7,
} as const

export const BALANCE_DIRECTIONS = ['below', 'above'] as const
export type BalanceDirection = (typeof BALANCE_DIRECTIONS)[number]

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

export interface ContractOverdueRule extends RuleBase {
  trigger: 'contract_overdue'
  days: number
}

export interface ContractAmountIncreasedRule extends RuleBase {
  trigger: 'contract_amount_increased'
}

export interface DuplicateTransactionRule extends RuleBase {
  trigger: 'duplicate_transaction'
  days: number
}

export interface UpcomingShortfallRule extends RuleBase {
  trigger: 'upcoming_shortfall'
  days: number
}

export interface TransactionRule extends RuleBase {
  trigger: 'transaction'
  other_party_contains: string | null
  categories: TransactionCategory[]
  types: TransactionType[]
  min_amount: number | null
  max_amount: number | null
}

export interface BalanceThresholdRule extends RuleBase {
  trigger: 'balance_threshold'
  threshold: number
  direction: BalanceDirection
}

export type NotificationRule =
  | ExpectedTransactionRule
  | ContractOverdueRule
  | ContractAmountIncreasedRule
  | DuplicateTransactionRule
  | UpcomingShortfallRule
  | TransactionRule
  | BalanceThresholdRule
export type NotificationRuleDraft =
  | Omit<ExpectedTransactionRule, 'id'>
  | Omit<ContractOverdueRule, 'id'>
  | Omit<ContractAmountIncreasedRule, 'id'>
  | Omit<DuplicateTransactionRule, 'id'>
  | Omit<UpcomingShortfallRule, 'id'>
  | Omit<TransactionRule, 'id'>
  | Omit<BalanceThresholdRule, 'id'>

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
  if (
    rule.trigger === 'upcoming_shortfall' ||
    rule.trigger === 'contract_overdue' ||
    rule.trigger === 'duplicate_transaction'
  ) {
    return JSON.stringify({ trigger: rule.trigger, accounts, days: rule.days })
  }
  if (rule.trigger === 'balance_threshold') {
    return JSON.stringify({
      trigger: rule.trigger,
      accounts,
      threshold: rule.threshold,
      direction: rule.direction,
    })
  }
  return JSON.stringify({ trigger: rule.trigger, accounts })
}

export const notificationRuleQueryKeys = {
  list: ['notification-rules'] as const,
}

export function useNotificationRules() {
  return useQuery({
    queryKey: notificationRuleQueryKeys.list,
    queryFn: () => api<NotificationRule[]>('/notification_rules'),
  })
}

export function useCreateNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (draft: NotificationRuleDraft) =>
      api<NotificationRule>('/notification_rules', { method: 'POST', body: draft }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}

export function useUpdateNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, draft }: { id: number; draft: NotificationRuleDraft }) =>
      api<NotificationRule>(`/notification_rules/${id}`, { method: 'PUT', body: draft }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}

export function useDeleteNotificationRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/notification_rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationRuleQueryKeys.list }),
  })
}
