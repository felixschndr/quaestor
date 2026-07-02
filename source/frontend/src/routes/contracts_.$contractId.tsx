import { useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import {
  CONTRACT_FREQUENCIES,
  OVERDUE_BANNER_MONTHS,
  monthsOverdue,
  useContract,
  useDeleteContract,
  useUpdateContract,
  type ContractDetailRead,
  type ContractMemberRead,
} from '@/lib/contract'
import { formatDate, formatDateWithoutYear, formatEuro, formatIban } from '@/lib/format'
import { TRANSACTION_CATEGORIES, type TransactionCategory } from '@/lib/transaction'
import { ContractTimeline } from '@/components/contract-timeline'
import { NoteEditor } from '@/components/note-editor'
import {
  ContractNameInput,
  DeleteContractButton,
  RenameContractButton,
} from '@/components/contract-actions'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/contracts_/$contractId')({
  component: ContractDetailPage,
})

function ContractDetailPage() {
  const { contractId: rawContractId } = Route.useParams()
  const contractId = Number(rawContractId)
  const query = useContract(contractId)
  const update = useUpdateContract(contractId)
  const remove = useDeleteContract()
  const navigate = useNavigate()
  const { t } = useTranslation()

  if (query.isLoading) return null
  if (!query.data) return <ContractNotFoundView />

  const onDelete = async () => {
    await remove.mutateAsync(contractId)
    await navigate({ to: '/contracts' })
  }

  return (
    <ContractDetailView
      contract={query.data}
      isDeleting={remove.isPending}
      onRename={(name) => update.mutateAsync({ name, category: query.data!.category })}
      onChangeCategory={(category) => update.mutateAsync({ name: query.data!.name, category })}
      onSaveNote={(note) =>
        update.mutateAsync({ name: query.data!.name, category: query.data!.category, note })
      }
      onDelete={() => {
        toast.promise(onDelete(), {
          loading: t('common.saving'),
          success: t('contracts.deleted'),
          error: t('errors.unexpected.title'),
        })
      }}
    />
  )
}

function ContractNotFoundView() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-3xl p-4">
      <BackLink />
      <p className="text-muted-foreground mt-6 text-sm">{t('contracts.notFound')}</p>
    </main>
  )
}

export interface ContractDetailViewProps {
  contract: ContractDetailRead
  isDeleting?: boolean
  onRename: (name: string) => Promise<unknown>
  onChangeCategory: (category: TransactionCategory) => Promise<unknown>
  onSaveNote: (note: string | null) => Promise<unknown>
  onDelete: () => void
}

export function ContractDetailView({
  contract,
  isDeleting,
  onRename,
  onChangeCategory,
  onSaveNote,
  onDelete,
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
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <BackLink />
        <div className="flex items-center gap-1">
          <RenameContractButton disabled={editingName} onClick={() => setEditingName(true)} />
          <DeleteContractButton onConfirm={onDelete} isDeleting={isDeleting} />
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
            {contract.is_overdue ? (
              <span className="bg-warning/10 text-warning shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold">
                {t('contracts.overdue')}
              </span>
            ) : null}
          </div>
        )}
        {editingName || contract.median_amount === null ? null : (
          <span className={cn('text-xl font-semibold tabular-nums', medianColor)}>
            {formatEuro(contract.median_amount)}
          </span>
        )}
      </section>

      <OverdueBanner contract={contract} />

      {activeMembers.length >= 2 ? (
        <section className="flex flex-col gap-2">
          <ContractTimeline
            members={contract.members}
            median={contract.median_amount}
            expectedNextDate={contract.expected_next_date}
          />
          {outlierCount > 0 ? (
            <p className="text-warning flex items-center gap-1.5 text-xs">
              <TriangleAlert className="size-3.5 shrink-0" />
              {t('contracts.outlierNote', { count: outlierCount })}
            </p>
          ) : null}
        </section>
      ) : null}

      <dl className="border-border bg-card grid grid-cols-2 gap-3 rounded-lg border p-3">
        <StripStat label={t('contracts.lastPayment')}>
          {lastPaymentDate ? formatDateWithoutYear(lastPaymentDate) : <Empty />}
        </StripStat>
        <StripStat label={t('contracts.nextExpected')} align="end">
          {contract.expected_next_date ? (
            <span className={cn(contract.is_overdue && 'text-warning')}>
              {formatDateWithoutYear(contract.expected_next_date)}
            </span>
          ) : (
            <Empty />
          )}
        </StripStat>
      </dl>

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

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">{t('contracts.category')}</h2>
        <ContractCategorySelect category={contract.category} onChange={onChangeCategory} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-foreground text-sm font-semibold">{t('contracts.note')}</h2>
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

function ContractCategorySelect({
  category,
  onChange,
}: {
  category: TransactionCategory | null
  onChange: (category: TransactionCategory) => Promise<unknown>
}) {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState(false)
  const options = useMemo(() => {
    const localised = TRANSACTION_CATEGORIES.filter((option) => option !== 'UNKNOWN').map(
      (option) => ({
        value: option,
        label: t(`category.${option}`),
        leading: <CategoryAvatar category={option} className="size-5" iconClassName="size-3" />,
      }),
    )
    localised.sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    return [
      ...localised,
      {
        value: 'UNKNOWN' as TransactionCategory,
        label: t('category.UNKNOWN'),
        leading: <CategoryAvatar category="UNKNOWN" className="size-5" iconClassName="size-3" />,
      },
    ]
  }, [t, i18n.language])

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
      ariaLabel={t('contracts.category')}
      value={(category ?? 'UNKNOWN') as TransactionCategory}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={options}
    />
  )
}

function MemberRow({ member }: { member: ContractMemberRead }) {
  const { t } = useTranslation()
  const otherParty = formatIban(member.other_party?.trim() || '') || t('account.unknownParty')
  const amountColor = member.is_outlier
    ? 'text-warning'
    : member.amount < 0
      ? 'text-destructive'
      : 'text-success'
  return (
    <li>
      <Link
        to="/account/$accountId/transactions/$transactionId"
        params={{ accountId: String(member.account_id), transactionId: String(member.id) }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md py-3 pl-3 transition-colors"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{otherParty}</span>
          <span className="text-muted-foreground truncate text-xs">{formatDate(member.date)}</span>
        </span>
        <span className={cn('text-sm font-semibold tabular-nums', amountColor)}>
          {formatEuro(member.amount)}
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
        {value === null ? <Empty /> : formatEuro(value)}
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
  align?: 'start' | 'center' | 'end'
  children: React.ReactNode
}) {
  const alignment =
    align === 'center' ? 'items-center text-center' : align === 'end' ? 'items-end text-right' : ''
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', alignment)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

function Empty() {
  const { t } = useTranslation()
  return <span className="text-muted-foreground">{t('transaction.fieldEmpty')}</span>
}

function OverdueBanner({ contract }: { contract: ContractDetailRead }) {
  const { t } = useTranslation()
  if (!contract.expected_next_date) return null
  const months = monthsOverdue(contract.expected_next_date)
  if (months < OVERDUE_BANNER_MONTHS) return null

  return (
    <div
      role="status"
      className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2.5 rounded-lg border p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{t('contracts.overdueBanner', { count: months })}</p>
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/contracts"
      className="text-primary hover:text-primary/80 -ml-1.5 inline-flex items-center gap-1 rounded-md p-1.5 text-sm transition-colors"
    >
      <ChevronLeft className="size-4" />
      {t('contracts.title')}
    </Link>
  )
}
