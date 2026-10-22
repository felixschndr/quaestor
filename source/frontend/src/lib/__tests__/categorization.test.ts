import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'

import { ApiError } from '@/lib/api'
import {
  categorizationQueryKeys,
  useCreateCategoryRule,
  useCategorization,
  useCreateCustomCategory,
  useCustomCategories,
  useDeleteCategoryRule,
  useDeleteCustomCategory,
  useReportCategorizationChange,
  useToggleDefaultMatcher,
  useUpdateCategoryRule,
  useUpdateCustomCategory,
} from '@/lib/categorization'
import type { CategoryKey } from '@/lib/transaction'
import { LABEL_GROCERIES, PARTY_SUPERMARKET } from '@/test/constants'

const CUSTOM_KEY: CategoryKey = 'CUSTOM_7'
const DEPENDENT_KEYS = [
  ['account', 3, 'history'],
  ['transaction'],
  ['transactions', 'search'],
  ['statistics'],
  ['contracts'],
]

let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

function respondWith(body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
}

function lastRequest() {
  const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
  return { url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined }
}

const invalidated = (queryKey: readonly unknown[]) =>
  queryClient.getQueryState(queryKey)?.isInvalidated ?? false

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const queryKey of [...DEPENDENT_KEYS, categorizationQueryKeys.all]) {
    queryClient.setQueryData(queryKey, [])
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('category rule mutations', () => {
  const rules = (recategorized: number) => ({ rules: [], default_matchers: [], recategorized })

  it.each([
    [
      'creates a rule',
      () => useCreateCategoryRule(),
      { pattern: PARTY_SUPERMARKET, category: 'SUPERMARKET' },
      { url: '/api/categorization/rules', method: 'POST' },
      { pattern: PARTY_SUPERMARKET, category: 'SUPERMARKET' },
    ],
    [
      'updates a rule',
      () => useUpdateCategoryRule(),
      { id: 5, pattern: PARTY_SUPERMARKET, category: 'SUPERMARKET' },
      { url: '/api/categorization/rules/5', method: 'PUT' },
      { pattern: PARTY_SUPERMARKET, category: 'SUPERMARKET' },
    ],
    [
      'deletes a rule',
      () => useDeleteCategoryRule(),
      5,
      { url: '/api/categorization/rules/5', method: 'DELETE' },
      undefined,
    ],
    [
      'switches a built-in matcher off',
      () => useToggleDefaultMatcher(),
      { pattern: PARTY_SUPERMARKET, disabled: true },
      { url: '/api/categorization/default-matchers', method: 'PUT' },
      { pattern: PARTY_SUPERMARKET, disabled: true },
    ],
  ])('%s and stores the new rule set', async (_, useHook, variables, request, body) => {
    respondWith(rules(0))
    const { result } = renderHook(
      useHook as () => { mutateAsync: (v: unknown) => Promise<unknown> },
      {
        wrapper,
      },
    )

    await act(() => result.current.mutateAsync(variables))

    expect(lastRequest()).toEqual({ ...request, body })
    expect(queryClient.getQueryData(categorizationQueryKeys.all)).toEqual(rules(0))
    for (const queryKey of DEPENDENT_KEYS) expect(invalidated(queryKey)).toBe(false)
  })

  it('reloads everything showing categories once transactions were recategorized', async () => {
    respondWith(rules(3))
    const { result } = renderHook(() => useCreateCategoryRule(), { wrapper })

    await act(() =>
      result.current.mutateAsync({ pattern: PARTY_SUPERMARKET, category: 'SUPERMARKET' }),
    )

    for (const queryKey of DEPENDENT_KEYS) expect(invalidated(queryKey)).toBe(true)
  })
})

describe('custom category mutations', () => {
  const customCategories = (recategorized: number) => ({
    custom_categories: [
      { key: CUSTOM_KEY, group: 'FOOD_AND_DRINK', name: LABEL_GROCERIES, owned: true },
    ],
    recategorized,
  })

  it.each([
    [
      'creates a category',
      () => useCreateCustomCategory(),
      { group: 'FOOD_AND_DRINK', name: LABEL_GROCERIES },
      { url: '/api/categorization/custom-categories', method: 'POST' },
      { group: 'FOOD_AND_DRINK', name: LABEL_GROCERIES },
    ],
    [
      'renames a category',
      () => useUpdateCustomCategory(),
      { key: CUSTOM_KEY, group: 'FOOD_AND_DRINK', name: LABEL_GROCERIES },
      { url: `/api/categorization/custom-categories/${CUSTOM_KEY}`, method: 'PUT' },
      { group: 'FOOD_AND_DRINK', name: LABEL_GROCERIES },
    ],
    [
      'deletes a category',
      () => useDeleteCustomCategory(),
      CUSTOM_KEY,
      { url: `/api/categorization/custom-categories/${CUSTOM_KEY}`, method: 'DELETE' },
      undefined,
    ],
  ])('%s and reloads the rules that may use it', async (_, useHook, variables, request, body) => {
    respondWith(customCategories(0))
    const { result } = renderHook(
      useHook as () => { mutateAsync: (v: unknown) => Promise<unknown> },
      {
        wrapper,
      },
    )

    await act(() => result.current.mutateAsync(variables))

    expect(lastRequest()).toEqual({ ...request, body })
    expect(queryClient.getQueryData(categorizationQueryKeys.customCategories)).toEqual(
      customCategories(0),
    )
    expect(invalidated(categorizationQueryKeys.all)).toBe(true)
    expect(invalidated(['transaction'])).toBe(false)
  })

  it('reloads the transactions once deleting a category recategorized them', async () => {
    respondWith(customCategories(2))
    const { result } = renderHook(() => useDeleteCustomCategory(), { wrapper })

    await act(() => result.current.mutateAsync(CUSTOM_KEY))

    for (const queryKey of DEPENDENT_KEYS) expect(invalidated(queryKey)).toBe(true)
  })
})

describe('categorization queries', () => {
  it('loads the rules and built-in matchers', async () => {
    queryClient.removeQueries({ queryKey: categorizationQueryKeys.all, exact: true })
    respondWith({ rules: [], default_matchers: [], recategorized: 0 })
    const { result } = renderHook(() => useCategorization(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(lastRequest().url).toBe('/api/categorization')
  })

  it('loads the custom categories', async () => {
    respondWith({ custom_categories: [], recategorized: 0 })
    const { result } = renderHook(() => useCustomCategories(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(lastRequest().url).toBe('/api/categorization/custom-categories')
  })

  it('stays idle while disabled', () => {
    respondWith({ custom_categories: [], recategorized: 0 })
    const { result } = renderHook(() => useCustomCategories({ enabled: false }), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('useReportCategorizationChange', () => {
  const SAVED = 'Rule saved'

  it.each([
    [0, SAVED],
    [1, `${SAVED} · 1 transaction recategorized`],
    [4, `${SAVED} · 4 transactions recategorized`],
  ])('reports %s recategorized transactions', async (recategorized, message) => {
    const { result } = renderHook(() => useReportCategorizationChange(), { wrapper })

    await expect(result.current(Promise.resolve({ recategorized }), SAVED)).resolves.toBe(true)

    expect(toast.success).toHaveBeenCalledExactlyOnceWith(message)
  })

  it('reports why the change failed', async () => {
    const { result } = renderHook(() => useReportCategorizationChange(), { wrapper })
    const failure = new ApiError(422, { detail: 'Pattern is too short' }, 'PUT → 422')

    await expect(result.current(Promise.reject(failure), SAVED)).resolves.toBe(false)

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Pattern is too short')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
