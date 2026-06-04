'use client'

import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FILTERABLE_CATEGORIES } from '@/lib/statistics'
import type { TransactionCategory } from '@/lib/transaction'

export interface CategoryMultiSelectProps {
  id?: string
  selectedIds: TransactionCategory[]
  onChange: (next: TransactionCategory[]) => void
  className?: string
}

/**
 * Popover with a checkbox per transaction category. Header offers "All" / "None"
 * shortcuts. Mirrors {@link AccountMultiSelect}; selection is fully controlled by
 * the parent. UNKNOWN is pinned last, everything else sorted by localized label.
 */
function CategoryMultiSelect({ id, selectedIds, onChange, className }: CategoryMultiSelectProps) {
  const { t, i18n } = useTranslation()

  const options = [...FILTERABLE_CATEGORIES].sort((a, b) => {
    if (a === 'UNKNOWN') return 1
    if (b === 'UNKNOWN') return -1
    return t(`category.${a}`).localeCompare(t(`category.${b}`), i18n.language)
  })
  const selectedSet = new Set(selectedIds)
  const selectedCount = selectedIds.length
  const totalCount = FILTERABLE_CATEGORIES.length
  const allSelected = totalCount > 0 && selectedCount === totalCount

  const triggerLabel =
    selectedCount === 0
      ? t('stats.categoriesNone')
      : allSelected
        ? t('stats.categoriesAll')
        : t('stats.categoriesCount', { count: selectedCount })

  const toggle = (category: TransactionCategory) => {
    const next = new Set(selectedSet)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    onChange([...next])
  }

  return (
    <Popover>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={t('stats.categoriesLabel')}
        className={cn(
          'border-input flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 py-1 text-left text-sm transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          'aria-expanded:border-ring',
          'dark:bg-input/30',
          className,
        )}
      >
        <span className={cn('truncate', selectedCount === 0 && 'text-muted-foreground')}>
          {triggerLabel}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <div className="border-border/40 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('stats.categoriesCount', { count: selectedCount })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-primary hover:text-primary/80 rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange([...FILTERABLE_CATEGORIES])}
            >
              {t('search.selectAll')}
            </button>
            <button
              type="button"
              className="text-primary hover:text-primary/80 rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange([])}
            >
              {t('search.selectNone')}
            </button>
          </div>
        </div>
        <ul aria-label={t('stats.categoriesLabel')} className="max-h-72 overflow-y-auto py-1">
          {options.map((category) => {
            const checkboxId = `category-multi-${category}`
            return (
              <li key={category}>
                <label
                  htmlFor={checkboxId}
                  className="hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                >
                  <span className="flex-1 truncate">{t(`category.${category}`)}</span>
                  <Checkbox
                    id={checkboxId}
                    checked={selectedSet.has(category)}
                    onCheckedChange={() => toggle(category)}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export { CategoryMultiSelect }
