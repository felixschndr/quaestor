import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { readApiErrorMessage } from '@/lib/apiError'
import { cn } from '@/lib/utils'
import { useCategoryOptions } from '@/lib/categoryIcons'
import {
  useCreateCategoryRule,
  useReportCategorizationChange,
  useUpdateCategoryRule,
  type CategoryRuleRead,
} from '@/lib/categorization'
import type { CategoryKey } from '@/lib/transaction'

export function CategoryRuleForm({
  rule,
  initialPattern = '',
  initialCategory = 'UNKNOWN',
  stacked = false,
  hint,
  onDone,
}: {
  rule?: CategoryRuleRead
  initialPattern?: string
  initialCategory?: CategoryKey
  // Rendered above the fields; it follows the category that is currently picked
  hint?: (category: CategoryKey) => ReactNode
  // Side by side by default; stacked where the form sits in a narrow container
  stacked?: boolean
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const options = useCategoryOptions().filter((option) => option.value !== 'UNKNOWN')
  const create = useCreateCategoryRule()
  const update = useUpdateCategoryRule()
  const report = useReportCategorizationChange()
  const [pattern, setPattern] = useState(rule?.pattern ?? initialPattern)
  const [category, setCategory] = useState<CategoryKey>(rule?.category ?? initialCategory)
  const pending = create.isPending || update.isPending
  const idPrefix = rule ? `rule-${rule.id}` : 'rule-new'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const payload = { pattern: pattern.trim(), category }
      const result = rule
        ? await update.mutateAsync({ id: rule.id, ...payload })
        : await create.mutateAsync(payload)
      report(result, t('categorization.saved'))
      if (!rule) setPattern('')
      onDone?.()
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  return (
    <>
      {hint ? <p className="text-muted-foreground text-sm">{hint(category)}</p> : null}
      <form
        onSubmit={submit}
        className={cn('flex flex-col gap-3', !stacked && 'sm:flex-row sm:items-end')}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-pattern`}>{t('categorization.pattern')}</Label>
          <Input
            id={`${idPrefix}-pattern`}
            value={pattern}
            placeholder={t('categorization.patternPlaceholder')}
            onChange={(event) => setPattern(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-category`}>{t('common.category')}</Label>
          <SingleSelectPopover
            id={`${idPrefix}-category`}
            ariaLabel={t('common.category')}
            value={category}
            onChange={setCategory}
            options={options}
            placeholder={t('common.category')}
            searchPlaceholder={t('search.filterPlaceholder')}
          />
        </div>
        {/* In the popover both buttons split the width on a phone */}
        <div className={cn('gap-2', stacked && onDone ? 'grid grid-cols-2 sm:flex' : 'flex')}>
          <Button
            type="submit"
            disabled={pending || pattern.trim().length === 0 || category === 'UNKNOWN'}
          >
            {rule ? t('common.save') : t('categorization.addRule')}
          </Button>
          {onDone ? (
            <Button type="button" variant="outline" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </>
  )
}
