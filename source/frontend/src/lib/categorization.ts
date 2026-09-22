import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api } from './api'
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
  // How many transactions the change re-categorized
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
  // False for a category of someone who shares an account with the user
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

// Every change may re-categorize transactions, so everything that shows categories is refetched
function useCategorizationMutation<TVars, TData extends { recategorized: number }>(
  mutationFn: (variables: TVars) => Promise<TData>,
  cacheKey: readonly unknown[] = categorizationQueryKeys.all,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(cacheKey, data)
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
  const queryClient = useQueryClient()
  const mutation = useCategorizationMutation(
    (key: CategoryKey) =>
      api<CustomCategoriesRead>(`/categorization/custom-categories/${key}`, { method: 'DELETE' }),
    categorizationQueryKeys.customCategories,
  )
  // Deleting also removes the rules that assigned the category
  return {
    ...mutation,
    mutateAsync: async (key: CategoryKey) => {
      const result = await mutation.mutateAsync(key)
      await queryClient.invalidateQueries({ queryKey: categorizationQueryKeys.all, exact: true })
      return result
    },
  }
}

export function useReportCategorizationChange() {
  const { t } = useTranslation()
  return (result: { recategorized: number }, success: string) =>
    toast.success(
      result.recategorized > 0
        ? `${success} · ${t('categorization.recategorized', { count: result.recategorized })}`
        : success,
    )
}
