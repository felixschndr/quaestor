import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'

import {
  useContract,
  useDeleteContract,
  useUpdateContract,
  type ContractDetailRead,
  type ContractMemberRead,
} from '@/lib/contract'
import { formatDate, formatEuro, formatIban } from '@/lib/format'
import { DeleteContractButton, RenameContractButton } from '@/components/contract-actions'
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
  onDelete: () => void
}

export function ContractDetailView({
  contract,
  isDeleting,
  onRename,
  onDelete,
}: ContractDetailViewProps) {
  const { t } = useTranslation()
  // Members arrive newest-first from the backend, so the first one is the last payment.
  const lastPaymentDate = contract.members[0]?.date ?? null

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 p-4">
      <header className="flex items-center justify-between gap-2">
        <BackLink />
        <div className="flex items-center gap-1">
          <RenameContractButton name={contract.name} onRename={onRename} />
          <DeleteContractButton onConfirm={onDelete} isDeleting={isDeleting} />
        </div>
      </header>

      <section className="flex flex-col items-center">
        <h1 className="text-foreground text-2xl font-semibold">{contract.name}</h1>
      </section>

      <dl className="grid grid-cols-2 gap-3">
        <SummaryCard label={t('contracts.turnus')}>
          {contract.frequency
            ? t(`contracts.frequency.${contract.frequency}`)
            : t('contracts.frequencyUnknown')}
        </SummaryCard>
        <SummaryCard label={t('contracts.median')}>
          {contract.median_amount === null ? <Empty /> : formatEuro(contract.median_amount)}
        </SummaryCard>
        <SummaryCard label={t('contracts.lastPayment')}>
          {lastPaymentDate ? formatDate(lastPaymentDate) : <Empty />}
        </SummaryCard>
        <SummaryCard label={t('contracts.nextExpected')}>
          {contract.expected_next_date ? formatDate(contract.expected_next_date) : <Empty />}
        </SummaryCard>
      </dl>

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

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-base font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

function Empty() {
  const { t } = useTranslation()
  return <span className="text-muted-foreground">{t('transaction.fieldEmpty')}</span>
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
