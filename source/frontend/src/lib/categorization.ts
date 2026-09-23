import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from './api'
import { readApiErrorMessage } from './apiError'
import { accountQueryKeys } from './accountHistory'
import { contractQueryKeys } from './contract'
import { statisticsQueryKeys } from './statistics'
import {
  transactionQueryKeys,
  type CategoryGroup,
  type CategoryKey,
  type TransactionCategory,
} from './transaction'
import { transactionSearchQueryKeys } from './transactionSearch'

export interface CategoryRuleRead {
  id: number
  pattern: string
  category: CategoryKey
  created_at: string
}

export interface DefaultMatcherRead {
  pattern: string
  category: TransactionCategory
  disabled: boolean
}

export interface CategorizationRead {
  rules: CategoryRuleRead[]
  default_matchers: DefaultMatcherRead[]
  recategorized: number
}

export interface CategoryRulePayload {
  pattern: string
  category: CategoryKey
}

export interface CustomCategoryRead {
  key: CategoryKey
  group: CategoryGroup
  name: string
  owned: boolean
}

export interface CustomCategoriesRead {
  custom_categories: CustomCategoryRead[]
  recategorized: number
}

export interface CustomCategoryPayload {
  group: CategoryGroup
  name: string
}

export const categorizationQueryKeys = {
  all: ['categorization'] as const,
  customCategories: ['categorization', 'custom-categories'] as const,
}

export function useCategorization() {
  return useQuery({
    queryKey: categorizationQueryKeys.all,
    queryFn: () => api<CategorizationRead>('/categorization'),
  })
}

export function useCustomCategories(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: categorizationQueryKeys.customCategories,
    queryFn: () => api<CustomCategoriesRead>('/categorization/custom-categories'),
    enabled: options?.enabled ?? true,
  })
}

function useCategorizationMutation<TVars, TData extends { recategorized: number }>(
  mutationFn: (variables: TVars) => Promise<TData>,
  cacheKey: readonly unknown[] = categorizationQueryKeys.all,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(cacheKey, data)
      if (cacheKey !== categorizationQueryKeys.all) {
        queryClient.invalidateQueries({ queryKey: categorizationQueryKeys.all, exact: true })
      }
      if (data.recategorized === 0) return
      for (const queryKey of [
        accountQueryKeys.all,
        transactionQueryKeys.all,
        transactionSearchQueryKeys.all,
        statisticsQueryKeys.all,
        contractQueryKeys.list,
      ]) {
        queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useCreateCategoryRule() {
  return useCategorizationMutation((payload: CategoryRulePayload) =>
    api<CategorizationRead>('/categorization/rules', { method: 'POST', body: payload }),
  )
}

export function useUpdateCategoryRule() {
  return useCategorizationMutation(({ id, ...payload }: CategoryRulePayload & { id: number }) =>
    api<CategorizationRead>(`/categorization/rules/${id}`, { method: 'PUT', body: payload }),
  )
}

export function useDeleteCategoryRule() {
  return useCategorizationMutation((ruleId: number) =>
    api<CategorizationRead>(`/categorization/rules/${ruleId}`, { method: 'DELETE' }),
  )
}

export function useToggleDefaultMatcher() {
  return useCategorizationMutation((payload: { pattern: string; disabled: boolean }) =>
    api<CategorizationRead>('/categorization/default-matchers', { method: 'PUT', body: payload }),
  )
}

export function useCreateCustomCategory() {
  return useCategorizationMutation(
    (payload: CustomCategoryPayload) =>
      api<CustomCategoriesRead>('/categorization/custom-categories', {
        method: 'POST',
        body: payload,
      }),
    categorizationQueryKeys.customCategories,
  )
}

export function useUpdateCustomCategory() {
  return useCategorizationMutation(
    ({ key, ...payload }: CustomCategoryPayload & { key: CategoryKey }) =>
      api<CustomCategoriesRead>(`/categorization/custom-categories/${key}`, {
        method: 'PUT',
        body: payload,
      }),
    categorizationQueryKeys.customCategories,
  )
}

export function useDeleteCustomCategory() {
  return useCategorizationMutation(
    (key: CategoryKey) =>
      api<CustomCategoriesRead>(`/categorization/custom-categories/${key}`, { method: 'DELETE' }),
    categorizationQueryKeys.customCategories,
  )
}

export function useReportCategorizationChange() {
  const { t } = useTranslation()
  return async (change: Promise<{ recategorized: number }>, success: string) => {
    try {
      const { recategorized } = await change
      toast.success(
        recategorized > 0
          ? `${success} · ${t('categorization.recategorized', { count: recategorized })}`
          : success,
      )
      return true
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
      return false
    }
  }
}
