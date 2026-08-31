import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Trash2, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  CONTRACT_FREQUENCIES,
  overdueDuration,
  type ContractDetailRead,
  type ContractFrequency,
  type ContractMemberRead,
} from '@/lib/contract'
import { formatDate, formatDateWithoutYear, formatMoney, transactionPartyName } from '@/lib/format'
import { type TransactionCategory } from '@/lib/transaction'
import { ContractTimeline } from '@/components/contract-timeline'
import { ContractStatusBadge } from '@/components/contract-status-badge'
import { NoteEditor } from '@/components/note-editor'
import {
  ArchiveContractButton,
  ContractNameInput,
  RenameContractButton,
} from '@/components/contract-actions'
import { RowActions } from '@/components/row-actions'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { useCategoryOptions } from '@/lib/categoryIcons'
import { useFrequencyOptions } from '@/lib/contractFrequencyIcons'
import { cn } from '@/lib/utils'
import type { ContractDetailViewProps } from '@/routes/contracts_.$contractId'
import { BackLink } from '@/components/back-link'
import { EmptyValue } from '@/components/empty-value'

export function ContractDetailView({
  contract,
  isDeleting,
  onRename,
  onChangeCategory,
  onChangeFrequency,
  onChangeEndDate,
  onSaveNote,
  onDelete,
  onSetArchived,
}: ContractDetailViewProps) {
  const { t } = useTranslation()
  const [editingName, setEditingName] = useState(false)
  const activeMembers = contract.members.filter(
    (member) => member.contract_assignment !== 'EXCLUDED',
  )
  const outlierCount = activeMembers.filter((member) => member.is_outlier).length
  const lastPaymentDate = activeMembers[0]?.date ?? null
  const medianColor =
    contract.median_amount === null
      ? ''
      : contract.median_amount < 0
        ? 'text-destructive'
        : 'text-success'

  const projection = contract.amount_per_frequency
  const projectionRows = projection
    ? [
        {
          key: 'perDay',
          label: t('contracts.period.DAY'),
          value: contract.amount_per_day,
          highlight: false,
        },
        ...CONTRACT_FREQUENCIES.map((frequency) => ({
          key: frequency,
          label: t(`contracts.period.${frequency}`),
          value: projection[frequency],
          highlight: frequency === contract.frequency,
        })),
      ]
    : []

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <BackLink to="/contracts">{t('contracts.title')}</BackLink>
        <div className="flex items-center gap-1">
          <RenameContractButton disabled={editingName} onClick={() => setEditingName(true)} />
          {contract.is_archived || contract.is_overdue ? (
            <ArchiveContractButton archived={contract.is_archived} onToggle={onSetArchived} />
          ) : null}
          <RowActions
            onDelete={onDelete}
            deleting={isDeleting}
            renderTrigger={(confirm) => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('contracts.delete')}
                onClick={confirm}
                className="text-muted-foreground hover:text-destructive px-1 sm:px-2.5"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          />
        </div>
      </header>

      <section className="flex min-h-9 flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {editingName ? (
          <ContractNameInput
            name={contract.name}
            onRename={onRename}
            onDone={() => setEditingName(false)}
          />
        ) : (
          <div className="flex max-w-full items-center gap-2">
            <h1 className="text-foreground max-w-full truncate text-xl font-semibold">
              {contract.name}
            </h1>
            <ContractStatusBadge contract={contract} size="md" />
          </div>
        )}
        {editingName || contract.median_amount === null ? null : (
          <span className={cn('text-xl font-semibold tabular-nums', medianColor)}>
            {formatMoney(contract.median_amount)}
          </span>
        )}
      </section>

      <OverdueBanner contract={contract} />

      {activeMembers.length >= 2 ? (
        <section className="flex flex-col gap-2">
          <ContractTimeline
            members={contract.members}
            median={contract.is_archived ? null : contract.median_amount}
            expectedNextDate={contract.is_archived ? null : contract.expected_next_date}
          />
          {outlierCount > 0 ? (
            <p className="text-warning flex items-center gap-1.5 text-xs">
              <TriangleAlert className="size-3.5 shrink-0" />
              {t('contracts.outlierNote', { count: outlierCount })}
            </p>
          ) : null}
        </section>
      ) : null}

      {contract.is_archived ? null : (
        <dl className="border-border bg-card grid grid-cols-2 gap-3 rounded-lg border p-3">
          <StripStat label={t('contracts.lastPayment')}>
            {lastPaymentDate ? formatDateWithoutYear(lastPaymentDate) : <EmptyValue />}
          </StripStat>
          <StripStat label={t('contracts.nextExpected')} align="end">
            {contract.expected_next_date ? (
              <span className={cn(contract.is_overdue && 'text-warning')}>
                {formatDateWithoutYear(contract.expected_next_date)}
              </span>
            ) : (
              <EmptyValue />
            )}
          </StripStat>
        </dl>
      )}

      {projection ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-foreground text-sm font-semibold">{t('contracts.normalized')}</h2>
          <div className="border-border bg-card relative rounded-lg border px-4 py-1 sm:grid sm:grid-cols-2">
            <dl className="divide-border divide-y sm:pr-6">
              {projectionRows.slice(0, 3).map((row) => (
                <ProjectionRow {...row} key={row.key} />
              ))}
            </dl>
            <dl className="divide-border divide-y border-t sm:border-t-0 sm:pl-6">
              {projectionRows.slice(3).map((row) => (
                <ProjectionRow {...row} key={row.key} />
              ))}
            </dl>
            <span
              aria-hidden
              className="bg-border absolute inset-y-2 left-1/2 hidden w-px sm:block"
            />
          </div>
        </section>
      ) : null}

      {contract.source === 'MANUAL' ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-foreground text-sm font-semibold">{t('contracts.turnus')}</h2>
          <ContractFrequencySelect frequency={contract.frequency} onChange={onChangeFrequency} />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">{t('common.category')}</h2>
        <ContractCategorySelect category={contract.category} onChange={onChangeCategory} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">{t('contracts.endDate')}</h2>
        <ContractEndDateEditor endDate={contract.end_date} onChange={onChangeEndDate} />
        <p className="text-muted-foreground text-xs">{t('contracts.endDateHint')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">{t('common.note')}</h2>
        <NoteEditor remoteNote={contract.note ?? ''} onSave={onSaveNote} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">
          {t('contracts.members', { count: contract.members.length })}
        </h2>
        {contract.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('contracts.noMembers')}</p>
        ) : (
          <ul className="flex flex-col">
            {contract.members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function ContractEndDateEditor({
  endDate,
  onChange,
}: {
  endDate: string | null
  onChange: (endDate: string | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)

  const change = async (next: string | null) => {
    setPending(true)
    try {
      await onChange(next)
    } catch {
      toast.error(t('errors.unexpected.title'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <DatePicker
        value={endDate ?? ''}
        placeholder={t('contracts.endDatePlaceholder')}
        className="flex-1"
        onChange={(next) => void change(next || null)}
      />
      {endDate ? (
        <Button
          type="button"
          variant="outline"
          size="default"
          disabled={pending}
          onClick={() => void change(null)}
          aria-label={t('contracts.clearEndDate')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

function ContractFrequencySelect({
  frequency,
  onChange,
}: {
  frequency: ContractFrequency | null
  onChange: (frequency: ContractFrequency | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const options = useFrequencyOptions()

  const change = async (next: ContractFrequency | 'NONE') => {
    setPending(true)
    try {
      await onChange(next === 'NONE' ? null : next)
    } catch {
      toast.error(t('errors.unexpected.title'))
    } finally {
      setPending(false)
    }
  }

  return (
    <SingleSelectPopover
      ariaLabel={t('contracts.turnus')}
      value={frequency ?? 'NONE'}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={options}
    />
  )
}

function ContractCategorySelect({
  category,
  onChange,
}: {
  category: TransactionCategory | null
  onChange: (category: TransactionCategory) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const options = useCategoryOptions()

  const change = async (next: TransactionCategory) => {
    setPending(true)
    try {
      await onChange(next)
    } catch {
      toast.error(t('transaction.categoryUpdateFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <SingleSelectPopover
      ariaLabel={t('common.category')}
      value={(category ?? 'UNKNOWN') as TransactionCategory}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={options}
    />
  )
}

function MemberRow({ member }: { member: ContractMemberRead }) {
  const { t } = useTranslation()
  const otherParty = transactionPartyName(member) || t('common.unknown')
  const amountColor = member.is_outlier
    ? 'text-warning'
    : member.amount < 0
      ? 'text-destructive'
      : 'text-success'
  return (
    <li>
      <Link
        to="/transactions/$transactionId"
        params={{ transactionId: String(member.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md py-3 pl-3 transition-colors"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{otherParty}</span>
          <span className="text-muted-foreground truncate text-xs">{formatDate(member.date)}</span>
        </span>
        <span className={cn('text-sm font-semibold tabular-nums', amountColor)}>
          {formatMoney(member.amount)}
        </span>
      </Link>
    </li>
  )
}

function ProjectionRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | null
  highlight?: boolean
}) {
  // The matched (real) frequency row is coloured by sign — green for income,
  // red for expense — to tie it to the headline amount.
  const highlightColor = value !== null && value < 0 ? 'text-destructive' : 'text-success'
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt
        className={cn(
          'text-sm',
          highlight ? cn(highlightColor, 'font-medium') : 'text-muted-foreground',
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          'text-sm font-semibold tabular-nums',
          highlight ? highlightColor : 'text-foreground',
        )}
      >
        {value === null ? <EmptyValue /> : formatMoney(value)}
      </dd>
    </div>
  )
}

function StripStat({
  label,
  align = 'start',
  children,
}: {
  label: string
  align?: 'start' | 'end'
  children: React.ReactNode
}) {
  const alignment = align === 'end' ? 'items-end text-right' : ''
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', alignment)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

function OverdueBanner({ contract }: { contract: ContractDetailRead }) {
  const { t } = useTranslation()
  if (contract.is_archived || !contract.expected_next_date || !contract.is_overdue) return null
  const { unit, count } = overdueDuration(contract.expected_next_date)

  return (
    <div
      role="status"
      className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2.5 rounded-lg border p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{t(`contracts.overdueBanner_${unit}`, { count })}</p>
    </div>
  )
}
