import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  BellRing,
  CalendarClock,
  CalendarX2,
  ChevronLeft,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { AmountInput } from '@/components/ui/amount-input'
import { AmountRangeFields } from '@/components/ui/amount-range-fields'
import { AccountMultiSelect } from '@/components/ui/account-multi-select'
import { CategoryMultiSelect } from '@/components/ui/category-multi-select'
import { TypeMultiSelect } from '@/components/ui/type-multi-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuthMe, type UserRead } from '@/lib/auth'
import { accountDisplayName } from '@/lib/accounts'
import { formatEuro } from '@/lib/format'
import { readApiErrorMessage } from '@/lib/apiError'
import { sendTestNotification } from '@/lib/push'
import { detectPlatform, isStandalone } from '@/lib/platform'
import { FILTERABLE_CATEGORIES } from '@/lib/statistics'
import {
  TRANSACTION_TYPES,
  type TransactionCategory,
  type TransactionType,
} from '@/lib/transaction'
import {
  BALANCE_DIRECTIONS,
  NOTIFICATION_TRIGGERS,
  useCreateNotificationRule,
  useDeleteNotificationRule,
  useNotificationRules,
  useUpdateNotificationRule,
  ruleSignature,
  type BalanceDirection,
  type NotificationRule,
  type NotificationRuleDraft,
  type NotificationTrigger,
} from '@/lib/notificationRules'

export const Route = createFileRoute('/settings/user/notifications')({
  component: SettingsNotificationsPage,
})

const TRIGGER_ICONS: Record<NotificationTrigger, LucideIcon> = {
  expected_transaction: CalendarClock,
  contract_overdue: CalendarX2,
  transaction: ArrowLeftRight,
  balance_threshold: TrendingDown,
}

function SettingsNotificationsPage() {
  const { data: user } = useAuthMe()
  if (!user) return null // root guard already redirected on 401
  return <SettingsNotificationsView user={user} />
}

export function SettingsNotificationsView({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const rules = useNotificationRules()
  // `null` = closed, `'new'` = create dialog, otherwise the rule being edited.
  const [editing, setEditing] = useState<NotificationRule | 'new' | null>(null)

  const accountNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const credential of user.credentials) {
      for (const account of credential.accounts) map.set(account.id, accountDisplayName(account))
    }
    return map
  }, [user.credentials])

  const allAccountIds = useMemo(
    () =>
      user.credentials.flatMap((credential) => credential.accounts.map((account) => account.id)),
    [user.credentials],
  )

  const [testPending, setTestPending] = useState(false)
  const handleSendTest = async () => {
    setTestPending(true)
    try {
      const outcome = await sendTestNotification()
      if (outcome.status === 'unsupported') toast.error(t('notifications.testUnsupported'))
      else if (outcome.status === 'denied') toast.error(t('notifications.testDenied'))
      else if (outcome.sent > 0) toast.success(t('notifications.testSent'))
      else toast.error(outcome.error ?? t('notifications.testFailed'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    } finally {
      setTestPending(false)
    }
  }

  const list = rules.data ?? []

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground flex-1 text-2xl font-semibold">
          {t('notifications.title')}
        </h1>
        <Button type="button" size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" aria-hidden="true" />
          {t('notifications.new')}
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">{t('notifications.description')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSendTest}
          disabled={testPending}
          className="shrink-0"
        >
          <BellRing className="size-3.5" aria-hidden="true" />
          {t('notifications.sendTest')}
        </Button>
      </div>

      <PwaInstallNotice />

      {rules.isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('notifications.empty')}</p>
      ) : (
        <ul className="border-border bg-card flex flex-col rounded-lg border">
          {list.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              accountNameById={accountNameById}
              allAccountIds={allAccountIds}
              onEdit={() => setEditing(rule)}
            />
          ))}
        </ul>
      )}

      {editing !== null ? (
        <RuleDialog
          user={user}
          rule={editing === 'new' ? null : editing}
          existingRules={list}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  )
}

function PwaInstallNotice() {
  const { t } = useTranslation()
  if (isStandalone()) return null

  const platform = detectPlatform()
  return (
    <div className="border-border bg-muted/40 text-muted-foreground flex gap-3 rounded-lg border p-3 text-sm">
      <Smartphone className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {platform === 'desktop' ? null : <p>{t('notifications.pwa.intro')}</p>}
        <p>{t(`notifications.pwa.${platform}`)}</p>
      </div>
    </div>
  )
}

function RuleRow({
  rule,
  accountNameById,
  allAccountIds,
  onEdit,
}: {
  rule: NotificationRule
  accountNameById: Map<number, string>
  allAccountIds: number[]
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateNotificationRule()
  const remove = useDeleteNotificationRule()
  const [confirming, setConfirming] = useState(false)
  const Icon =
    rule.trigger === 'balance_threshold' && rule.direction === 'above'
      ? TrendingUp
      : TRIGGER_ICONS[rule.trigger]

  const toggleEnabled = async (enabled: boolean) => {
    const { id, ...draft } = rule
    try {
      await update.mutateAsync({ id, draft: { ...draft, enabled } as NotificationRuleDraft })
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  const onDelete = async () => {
    try {
      await remove.mutateAsync(rule.id)
      toast.success(t('notifications.deleted'))
    } catch (err) {
      setConfirming(false)
      toast.error(readApiErrorMessage(err, t))
    }
  }

  return (
    <li className="border-border/40 flex items-center gap-3 border-t p-3 first:border-t-0">
      <Icon
        className={
          rule.enabled ? 'text-primary size-5 shrink-0' : 'text-muted-foreground size-5 shrink-0'
        }
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {rule.name?.trim() || t(`notifications.trigger.${rule.trigger}`)}
        </span>
        {ruleSummaryLines(rule, t, accountNameById, allAccountIds).map((line) => (
          <span key={line.label} className="text-muted-foreground text-xs">
            <span className="text-foreground/70 font-medium">{line.label}:</span> {line.value}
          </span>
        ))}
      </div>
      <Switch
        checked={rule.enabled}
        disabled={update.isPending}
        onCheckedChange={toggleEnabled}
        aria-label={t('notifications.enabledLabel')}
      />
      {confirming ? (
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={onDelete}
          >
            {t('notifications.confirmDelete')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={t('notifications.edit')}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
            aria-label={t('notifications.delete')}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Editor dialog                                                              */
/* -------------------------------------------------------------------------- */

interface RuleFormModel {
  trigger: NotificationTrigger
  enabled: boolean
  include_content: boolean
  name: string
  account_ids: number[]
  other_party_contains: string
  categories: TransactionCategory[]
  types: TransactionType[]
  min_amount: number | undefined
  max_amount: number | undefined
  threshold: number | undefined
  direction: BalanceDirection
}

// New rules start with every account, category and type selected.
interface RuleDefaults {
  accountIds: number[]
  categories: TransactionCategory[]
  types: TransactionType[]
}

function modelFromRule(rule: NotificationRule | null, defaults: RuleDefaults): RuleFormModel {
  const base: RuleFormModel = {
    trigger: rule?.trigger ?? 'transaction',
    enabled: rule?.enabled ?? true,
    include_content: rule?.include_content ?? true,
    name: rule?.name ?? '',
    account_ids: rule?.account_ids ?? defaults.accountIds,
    other_party_contains: '',
    categories: defaults.categories,
    types: defaults.types,
    min_amount: undefined,
    max_amount: undefined,
    threshold: undefined,
    direction: 'below',
  }
  if (rule?.trigger === 'transaction') {
    base.other_party_contains = rule.other_party_contains ?? ''
    base.categories = rule.categories
    base.types = rule.types
    base.min_amount = rule.min_amount ?? undefined
    base.max_amount = rule.max_amount ?? undefined
  } else if (rule?.trigger === 'balance_threshold') {
    base.threshold = rule.threshold
    base.direction = rule.direction
  }
  return base
}

function modelToDraft(model: RuleFormModel): NotificationRuleDraft {
  const shared = {
    enabled: model.enabled,
    include_content: model.include_content,
    name: model.name.trim() || null,
    account_ids: model.account_ids,
  }
  switch (model.trigger) {
    case 'expected_transaction':
      return { ...shared, trigger: 'expected_transaction' }
    case 'contract_overdue':
      return { ...shared, trigger: 'contract_overdue' }
    case 'balance_threshold':
      return {
        ...shared,
        trigger: 'balance_threshold',
        threshold: model.threshold ?? 0,
        direction: model.direction,
      }
    case 'transaction':
      return {
        ...shared,
        trigger: 'transaction',
        other_party_contains: model.other_party_contains.trim() || null,
        categories: model.categories,
        types: model.types,
        min_amount: model.min_amount ?? null,
        max_amount: model.max_amount ?? null,
      }
  }
}

function RuleDialog({
  user,
  rule,
  existingRules,
  onClose,
}: {
  user: UserRead
  rule: NotificationRule | null
  existingRules: NotificationRule[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateNotificationRule()
  const update = useUpdateNotificationRule()
  const allAccountIds = useMemo(
    () =>
      user.credentials.flatMap((credential) => credential.accounts.map((account) => account.id)),
    [user.credentials],
  )
  const [model, setModel] = useState<RuleFormModel>(() =>
    modelFromRule(rule, {
      accountIds: allAccountIds,
      categories: [...FILTERABLE_CATEGORIES],
      types: [...TRANSACTION_TYPES],
    }),
  )
  const [accountError, setAccountError] = useState(false)
  const [thresholdError, setThresholdError] = useState(false)

  const set = <K extends keyof RuleFormModel>(key: K, value: RuleFormModel[K]) =>
    setModel((current) => ({ ...current, [key]: value }))

  const pending = create.isPending || update.isPending

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    // At least one account is required — "all accounts" is not allowed.
    if (model.account_ids.length === 0) {
      setAccountError(true)
      return
    }
    // The balance threshold is mandatory for the balance_threshold trigger.
    if (model.trigger === 'balance_threshold' && model.threshold === undefined) {
      setThresholdError(true)
      return
    }

    const draft = modelToDraft(model)

    // Reject an exact duplicate of an existing rule (ignoring its enabled flag).
    const signature = ruleSignature(draft)
    const isDuplicate = existingRules.some(
      (existing) => existing.id !== rule?.id && ruleSignature(existing) === signature,
    )
    if (isDuplicate) {
      toast.error(t('notifications.duplicate'))
      return
    }

    try {
      if (rule) await update.mutateAsync({ id: rule.id, draft })
      else await create.mutateAsync(draft)
      onClose()
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[46rem] overflow-y-auto"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{rule ? t('notifications.edit') : t('notifications.create')}</DialogTitle>
          <DialogDescription>{t(`notifications.triggerHint.${model.trigger}`)}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="rule-enabled" className="cursor-pointer">
              {t('notifications.enabledLabel')}
            </Label>
            <Switch
              id="rule-enabled"
              checked={model.enabled}
              onCheckedChange={(next) => set('enabled', next)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-name">{t('notifications.nameLabel')}</Label>
            <Input
              id="rule-name"
              value={model.name}
              placeholder={t('notifications.namePlaceholder')}
              onChange={(event) => set('name', event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-trigger">{t('notifications.triggerLabel')}</Label>
            <SingleSelectPopover
              id="rule-trigger"
              ariaLabel={t('notifications.triggerLabel')}
              value={model.trigger}
              onChange={(next) => set('trigger', next)}
              options={NOTIFICATION_TRIGGERS.map((trigger) => ({
                value: trigger,
                label: t(`notifications.trigger.${trigger}`),
              }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-accounts">{t('notifications.accountsLabel')}</Label>
            <AccountMultiSelect
              id="rule-accounts"
              credentials={user.credentials}
              selectedIds={model.account_ids}
              onChange={(next) => {
                set('account_ids', next)
                if (next.length > 0) setAccountError(false)
              }}
            />
            {accountError ? (
              <p role="alert" className="text-destructive text-xs">
                {t('notifications.accountsRequired')}
              </p>
            ) : null}
          </div>

          {model.trigger === 'transaction' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-sender">{t('notifications.senderLabel')}</Label>
                <Input
                  id="rule-sender"
                  value={model.other_party_contains}
                  placeholder={t('notifications.senderPlaceholder')}
                  onChange={(event) => set('other_party_contains', event.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rule-categories">{t('notifications.categoriesLabel')}</Label>
                  <CategoryMultiSelect
                    id="rule-categories"
                    selectedIds={model.categories}
                    onChange={(next) => set('categories', next)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rule-types">{t('notifications.typesLabel')}</Label>
                  <TypeMultiSelect
                    id="rule-types"
                    selected={model.types}
                    onChange={(next) => set('types', next)}
                  />
                </div>
              </div>
              <AmountRangeFields
                idPrefix="rule"
                fromLabel={t('notifications.amountFromLabel')}
                toLabel={t('notifications.amountToLabel')}
                from={model.min_amount}
                to={model.max_amount}
                onFromChange={(next) => set('min_amount', next)}
                onToChange={(next) => set('max_amount', next)}
              />
            </>
          ) : null}

          {model.trigger === 'balance_threshold' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-direction">{t('notifications.directionLabel')}</Label>
                <SingleSelectPopover
                  id="rule-direction"
                  ariaLabel={t('notifications.directionLabel')}
                  value={model.direction}
                  onChange={(next) => set('direction', next)}
                  options={BALANCE_DIRECTIONS.map((direction) => ({
                    value: direction,
                    label: t(`notifications.direction.${direction}`),
                  }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rule-threshold">{t('notifications.thresholdLabel')}</Label>
                <AmountInput
                  id="rule-threshold"
                  value={model.threshold}
                  aria-invalid={thresholdError || undefined}
                  onChange={(next) => {
                    set('threshold', next)
                    if (next !== undefined) setThresholdError(false)
                  }}
                />
                {thresholdError ? (
                  <p role="alert" className="text-destructive text-xs">
                    {t('notifications.thresholdRequired')}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="rule-include-content" className="cursor-pointer">
                {t('notifications.includeContentLabel')}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t('notifications.includeContentHint')}
              </p>
            </div>
            <Switch
              id="rule-include-content"
              checked={model.include_content}
              onCheckedChange={(next) => set('include_content', next)}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('notifications.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */

// Each criterion becomes its own labelled line in the rule list.
function ruleSummaryLines(
  rule: NotificationRule,
  t: TFunction,
  accountNameById: Map<number, string>,
  allAccountIds: number[],
): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = []

  // When a custom name is the title, surface the trigger as its own line too.
  if (rule.name?.trim()) {
    lines.push({
      label: t('notifications.triggerLabel'),
      value: t(`notifications.trigger.${rule.trigger}`),
    })
  }

  lines.push({
    label: t('notifications.accountsLabel'),
    value: describeAccounts(rule.account_ids, allAccountIds, t, accountNameById),
  })

  if (rule.trigger === 'transaction') {
    if (rule.other_party_contains) {
      lines.push({ label: t('notifications.senderLabel'), value: rule.other_party_contains })
    }
    lines.push({
      label: t('notifications.categoriesLabel'),
      value: describeSelection(
        rule.categories,
        FILTERABLE_CATEGORIES.length,
        (category) => t(`category.${category}`),
        t('notifications.allCategories'),
      ),
    })
    lines.push({
      label: t('notifications.typesLabel'),
      value: describeSelection(
        rule.types,
        TRANSACTION_TYPES.length,
        (type) => t(`transactionType.${type}`),
        t('notifications.allTypes'),
      ),
    })
    lines.push({
      label: t('notifications.amountLabel'),
      value: describeAmountRange(rule.min_amount, rule.max_amount, t),
    })
  } else if (rule.trigger === 'balance_threshold') {
    lines.push({
      label: t('notifications.directionLabel'),
      value: t(`notifications.direction.${rule.direction}`),
    })
    lines.push({
      label: t('notifications.thresholdLabel'),
      value: formatEuro(rule.threshold ?? 0),
    })
  }

  lines.push({
    label: t('notifications.includeContentLabel'),
    value: rule.include_content
      ? t('notifications.includeContentOn')
      : t('notifications.includeContentOff'),
  })

  return lines
}

function describeAccounts(
  accountIds: number[],
  allAccountIds: number[],
  t: TFunction,
  accountNameById: Map<number, string>,
): string {
  const selected = new Set(accountIds)
  if (allAccountIds.length > 0 && allAccountIds.every((id) => selected.has(id))) {
    return t('notifications.allAccounts')
  }
  const names = accountIds
    .map((id) => accountNameById.get(id))
    .filter((name): name is string => Boolean(name))
  return names.length > 0 ? names.join(', ') : t('notifications.allAccounts')
}

function describeSelection<T>(
  selected: T[],
  totalCount: number,
  label: (value: T) => string,
  allLabel: string,
): string {
  if (selected.length === 0) return '—'
  if (selected.length >= totalCount) return allLabel
  return selected.map(label).join(', ')
}

function describeAmountRange(min: number | null, max: number | null, t: TFunction): string {
  if (min !== null && max !== null) {
    return t('notifications.summary.amountBetween', { from: formatEuro(min), to: formatEuro(max) })
  }
  if (min !== null) return t('notifications.summary.amountFrom', { amount: formatEuro(min) })
  if (max !== null) return t('notifications.summary.amountTo', { amount: formatEuro(max) })
  return t('notifications.anyAmount')
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings/user"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
