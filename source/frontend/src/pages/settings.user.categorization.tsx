import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

import { CategoryRuleForm } from '@/components/category-rule-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { Switch } from '@/components/ui/switch'
import { RowActions } from '@/components/row-actions'
import { ListSkeleton } from '@/components/list-skeleton'
import { QueryStates } from '@/components/query-states'
import { SettingsSubPage } from '@/components/settings/settings-section'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { matchesQuery } from '@/components/ui/popover-search-input'
import {
  useCategorization,
  useCreateCustomCategory,
  useDeleteCategoryRule,
  useDeleteCustomCategory,
  useReportCategorizationChange,
  useToggleDefaultMatcher,
  useUpdateCustomCategory,
  type CategoryRuleRead,
  type CustomCategoryRead,
  type DefaultMatcherRead,
} from '@/lib/categorization'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import { CATEGORY_GROUPS, type CategoryGroup, type CategoryKey } from '@/lib/transaction'

export function SettingsCategorizationView() {
  const { t } = useTranslation()
  const categorization = useCategorization()

  return (
    <SettingsSubPage title={t('categorization.title')}>
      <p className="text-muted-foreground text-sm">{t('categorization.intro')}</p>
      <QueryStates
        query={categorization}
        loadingText={t('common.loading')}
        loadingSkeleton={<ListSkeleton rows={3} />}
        errorText={t('categorization.loadError')}
      >
        {categorization.data ? (
          <>
            <CustomCategoriesSection />
            <RulesSection
              rules={categorization.data.rules}
              matchers={categorization.data.default_matchers}
            />
          </>
        ) : null}
      </QueryStates>
    </SettingsSubPage>
  )
}

function RulesSection({
  rules,
  matchers,
}: {
  rules: CategoryRuleRead[]
  matchers: DefaultMatcherRead[]
}) {
  const { t, i18n } = useTranslation()
  const catalog = useCategoryCatalog()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(rules.map((rule) => rule.category)),
  )

  const matchesSearch = (pattern: string, category: string) =>
    !query || matchesQuery(pattern, query) || matchesQuery(catalog.label(category), query)
  const visibleRules = rules.filter((rule) => matchesSearch(rule.pattern, rule.category))
  const visibleMatchers = matchers.filter((matcher) =>
    matchesSearch(matcher.pattern, matcher.category),
  )
  const byCategory = [
    ...new Set([
      ...visibleRules.map((rule) => rule.category),
      ...visibleMatchers.map((matcher) => matcher.category),
    ]),
  ]
    .map((category) => ({
      category,
      own: visibleRules.filter((rule) => rule.category === category),
      defaults: visibleMatchers.filter((matcher) => matcher.category === category),
    }))
    .sort((a, b) =>
      catalog.label(a.category).localeCompare(catalog.label(b.category), i18n.language),
    )

  const setOpen = (category: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(category)
      else next.delete(category)
      return next
    })

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-base font-semibold">
          {t('categorization.rulesTitle')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('categorization.rulesDescription')}</p>
      </div>
      <CategoryRuleForm key="new" />
      <Input
        type="search"
        aria-label={t('common.search')}
        placeholder={t('search.filterPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {byCategory.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('categorization.noMatches')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {byCategory.map(({ category, own, defaults }) => {
            const disabledCount = defaults.filter((matcher) => matcher.disabled).length
            return (
              <li key={category} className="border-border/40 border-t first:border-t-0">
                <details
                  open={query ? true : expanded.has(category)}
                  onToggle={(event) => setOpen(category, event.currentTarget.open)}
                  className="group"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3 select-none">
                    <ChevronRight
                      className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                    <CategoryAvatar category={category} className="size-8" iconClassName="size-4" />
                    <span className="truncate text-sm font-medium">{catalog.label(category)}</span>
                    <span className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
                      {disabledCount > 0
                        ? t('categorization.matcherCountWithDisabled', {
                            count: own.length + defaults.length,
                            disabled: disabledCount,
                          })
                        : t('categorization.matcherCount', { count: own.length + defaults.length })}
                    </span>
                  </summary>
                  <ul className="flex flex-col px-3 pb-3 pl-14">
                    {own.map((rule) =>
                      editingId === rule.id ? (
                        <li key={rule.id} className="py-1.5">
                          <CategoryRuleForm rule={rule} onDone={() => setEditingId(null)} />
                        </li>
                      ) : (
                        <RuleRow key={rule.id} rule={rule} onEdit={() => setEditingId(rule.id)} />
                      ),
                    )}
                    {defaults.map((matcher) => (
                      <DefaultMatcherRow key={matcher.pattern} matcher={matcher} />
                    ))}
                  </ul>
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function CustomCategoriesSection() {
  const { t } = useTranslation()
  const { owned } = useCategoryCatalog()
  const [editingKey, setEditingKey] = useState<CategoryKey | null>(null)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-base font-semibold">
          {t('categorization.customTitle')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('categorization.customDescription')}</p>
      </div>
      <CustomCategoryForm key="new" />
      {owned.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('categorization.customEmpty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {owned.map((category) =>
            editingKey === category.key ? (
              <li key={category.key} className="border-border/40 border-t p-3 first:border-t-0">
                <CustomCategoryForm category={category} onDone={() => setEditingKey(null)} />
              </li>
            ) : (
              <CustomCategoryRow
                key={category.key}
                category={category}
                onEdit={() => setEditingKey(category.key)}
              />
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function CustomCategoryForm({
  category,
  onDone,
}: {
  category?: CustomCategoryRead
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateCustomCategory()
  const update = useUpdateCustomCategory()
  const report = useReportCategorizationChange()
  const [name, setName] = useState(category?.name ?? '')
  const [group, setGroup] = useState<CategoryGroup>(category?.group ?? 'FOOD_AND_DRINK')
  const idPrefix = category ? `custom-${category.key}` : 'custom-new'
  const groupOptions = CATEGORY_GROUPS.map((value) => ({
    value,
    label: t(`common.transactionLabel.${value}`),
    leading: <CategoryAvatar category={value} className="size-5" iconClassName="size-3" />,
  }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = { group, name: name.trim() }
    const saved = await report(
      category
        ? update.mutateAsync({ key: category.key, ...payload })
        : create.mutateAsync(payload),
      t('categorization.customSaved'),
    )
    if (!saved) return
    if (!category) setName('')
    onDone?.()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-name`}>{t('categorization.customName')}</Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          maxLength={50}
          placeholder={t('categorization.customNamePlaceholder')}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-group`}>{t('categorization.customGroup')}</Label>
        <SingleSelectPopover
          id={`${idPrefix}-group`}
          ariaLabel={t('categorization.customGroup')}
          value={group}
          onChange={setGroup}
          options={groupOptions}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={create.isPending || update.isPending || name.trim().length === 0}
        >
          {category ? t('common.save') : t('categorization.customAdd')}
        </Button>
        {onDone ? (
          <Button type="button" variant="outline" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function CustomCategoryRow({
  category,
  onEdit,
}: {
  category: CustomCategoryRead
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const remove = useDeleteCustomCategory()
  const report = useReportCategorizationChange()

  const onDelete = () => report(remove.mutateAsync(category.key), t('categorization.customDeleted'))

  return (
    <li className="border-border/40 flex items-center gap-3 border-t p-3 first:border-t-0">
      <CategoryAvatar category={category.key} className="size-8" iconClassName="size-4" />
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground self-center">
          {/* The long label eats the width a phone needs for the name itself */}
          <span className="sm:hidden">{t('common.name')}</span>
          <span className="hidden sm:inline">{t('categorization.customName')}</span>
        </dt>
        <dd className="truncate text-sm">{category.name}</dd>
        <dt className="text-muted-foreground self-center">{t('categorization.customGroup')}</dt>
        <dd className="truncate text-sm">{t(`common.transactionLabel.${category.group}`)}</dd>
      </dl>
      <RowActions
        onEdit={onEdit}
        onDelete={onDelete}
        deleting={remove.isPending}
        confirmLabel={t('categorization.customDeleteConfirm')}
      />
    </li>
  )
}

function RuleRow({ rule, onEdit }: { rule: CategoryRuleRead; onEdit: () => void }) {
  const { t } = useTranslation()
  const remove = useDeleteCategoryRule()
  const report = useReportCategorizationChange()

  const onDelete = () => report(remove.mutateAsync(rule.id), t('categorization.deleted'))

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{rule.pattern}</span>
      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
        <span className="sm:hidden">{t('categorization.ownRuleShort')}</span>
        <span className="hidden sm:inline">{t('categorization.ownRule')}</span>
      </span>
      <RowActions onEdit={onEdit} onDelete={onDelete} deleting={remove.isPending} size="sm" />
    </li>
  )
}

function DefaultMatcherRow({ matcher }: { matcher: DefaultMatcherRead }) {
  const { t } = useTranslation()
  const toggle = useToggleDefaultMatcher()
  const report = useReportCategorizationChange()

  const onToggle = (enabled: boolean) =>
    report(
      toggle.mutateAsync({ pattern: matcher.pattern, disabled: !enabled }),
      t('categorization.saved'),
    )

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{matcher.pattern}</span>
      <Switch
        aria-label={matcher.pattern}
        checked={!matcher.disabled}
        disabled={toggle.isPending}
        onCheckedChange={(enabled) => void onToggle(enabled)}
      />
    </li>
  )
}
