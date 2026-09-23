import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useCustomCategories, type CustomCategoryRead } from '@/lib/categorization'
import {
  CATEGORIES_BY_GROUP,
  CATEGORY_GROUP_OF,
  isCategoryGroup,
  TRANSACTION_CATEGORIES,
  type CategoryGroup,
  type CategoryKey,
  type TransactionCategory,
} from '@/lib/transaction'

const NO_CUSTOM_CATEGORIES: CustomCategoryRead[] = []

// Without a provider (e.g. in isolated component tests) only the fixed categories are known
const CustomCategoriesContext = createContext<readonly CustomCategoryRead[]>(NO_CUSTOM_CATEGORIES)

export function CategoryCatalogProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const { data } = useCustomCategories({ enabled })
  return (
    <CustomCategoriesContext.Provider value={data?.custom_categories ?? NO_CUSTOM_CATEGORIES}>
      {children}
    </CustomCategoriesContext.Provider>
  )
}

export type CategoryCatalog = ReturnType<typeof useCategoryCatalog>

export function useCategoryCatalog() {
  const custom = useContext(CustomCategoriesContext)
  const { t, i18n } = useTranslation()
  return useMemo(() => {
    const byKey = new Map(custom.map((category) => [category.key as string, category]))
    const owned = [...custom]
      .filter((category) => category.owned)
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
    return {
      custom,
      owned,
      label: (key: string): string =>
        byKey.get(key)?.name ??
        t(`common.transactionLabel.${key}`, { defaultValue: t('common.unknown') }),
      groupOf: (key: string): CategoryGroup | undefined =>
        isCategoryGroup(key)
          ? key
          : (CATEGORY_GROUP_OF[key as TransactionCategory] ?? byKey.get(key)?.group),
      allKeys: [...TRANSACTION_CATEGORIES, ...owned.map((category) => category.key)],
      categoriesOf: (group: CategoryGroup, includeCustom = true): CategoryKey[] => [
        ...CATEGORIES_BY_GROUP[group],
        ...(includeCustom
          ? owned.filter((category) => category.group === group).map((category) => category.key)
          : []),
      ],
    }
  }, [custom, t, i18n.language])
}
