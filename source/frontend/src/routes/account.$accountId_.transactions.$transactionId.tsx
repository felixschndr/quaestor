import { type ReactNode } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'
import { findAccountInUser } from '@/lib/accountHistory'
import { formatDate, formatEuro } from '@/lib/format'
import {
  useLinkTransfer,
  useTransaction,
  useUpdateTransaction,
  useUnlinkTransfer,
  type TransactionCategory,
} from '@/lib/transaction'
import { useAuthMe } from '@/lib/auth'
import { useContracts, useSetTransactionContract } from '@/lib/contract'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'
import {
  TransactionDetailView,
  transferPartnerLabel,
} from '@/pages/account.$accountId_.transactions.$transactionId'

const searchParamsSchema = z.object({
  link_account_id: z.coerce.number().optional(),
  link_transaction_id: z.coerce.number().optional(),
})

export const Route = createFileRoute('/account/$accountId_/transactions/$transactionId')({
  component: TransactionDetailPage,
  validateSearch: (search) => searchParamsSchema.parse(search),
})

function TransactionDetailPage() {
  const { accountId: rawAccountId, transactionId: rawTransactionId } = Route.useParams()
  const accountId = Number(rawAccountId)
  const transactionId = Number(rawTransactionId)
  const search = Route.useSearch()
  const query = useTransaction(accountId, transactionId)
  const update = useUpdateTransaction(accountId, transactionId)
  const unlink = useUnlinkTransfer(accountId, transactionId)
  const { data: user } = useAuthMe()

  if (query.isLoading) return null
  if (!query.data) return <TransactionNotFoundView accountId={accountId} />

  const counterpart = query.data.transfer_counterpart
  const counterpartAccount = counterpart
    ? findAccountInUser(user, counterpart.account_id)?.account
    : null
  const counterpartAccountName = counterpartAccount
    ? counterpartAccount.display_name?.trim() || counterpartAccount.name
    : null

  const account = findAccountInUser(user, accountId)?.account
  const accountName = account ? account.display_name?.trim() || account.name : null

  const linkSource =
    search.link_account_id !== undefined && search.link_transaction_id !== undefined
      ? { accountId: search.link_account_id, transactionId: search.link_transaction_id }
      : null
  const viewingLinkSourceItself =
    linkSource?.accountId === accountId && linkSource?.transactionId === transactionId
  const canStartLink = linkSource === null && !query.data.pending
  const allAccountIds =
    user?.credentials.flatMap((credential) => credential.accounts.map((a) => a.id)) ?? []

  return (
    <TransactionDetailView
      key={`${accountId}-${transactionId}`}
      accountId={accountId}
      transaction={query.data}
      accountName={accountName}
      counterpartAccountName={counterpartAccountName}
      onSaveNote={(note) => update.mutateAsync({ note })}
      onChangeCategory={(category) => update.mutateAsync({ category })}
      onUnlink={() => unlink.mutateAsync()}
      contractSection={
        query.data.pending ? undefined : <ContractSection transaction={query.data} />
      }
      linkSection={
        canStartLink ? (
          <LinkStartSection
            accountId={accountId}
            transactionId={transactionId}
            allAccountIds={allAccountIds}
          />
        ) : undefined
      }
      linkConfirmSection={
        linkSource && !viewingLinkSourceItself && !counterpart && !query.data.pending ? (
          <LinkConfirmSection source={linkSource} targetAccountId={accountId} target={query.data} />
        ) : undefined
      }
    />
  )
}

function LinkStartSection({
  accountId,
  transactionId,
  allAccountIds,
}: {
  accountId: number
  transactionId: number
  allAccountIds: number[]
}) {
  const { t } = useTranslation()
  return (
    <DetailRow label={t('transaction.linkedTransaction')}>
      <Button asChild variant="outline" size="sm">
        <Link
          to="/account/$accountId/search"
          params={{ accountId: String(accountId) }}
          search={{
            account_ids: allAccountIds,
            link_account_id: accountId,
            link_transaction_id: transactionId,
          }}
        >
          <ArrowLeftRight className="size-4" aria-hidden="true" />
          {t('transaction.linkStart')}
        </Link>
      </Button>
    </DetailRow>
  )
}

function LinkConfirmSection({
  source,
  targetAccountId,
  target,
}: {
  source: { accountId: number; transactionId: number }
  targetAccountId: number
  target: TransactionDetailRead
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: user } = useAuthMe()
  const sourceQuery = useTransaction(source.accountId, source.transactionId)
  const link = useLinkTransfer(source.accountId, source.transactionId)

  const sourceTransaction = sourceQuery.data
  if (!sourceTransaction) return null
  if (sourceTransaction.transfer_counterpart || sourceTransaction.pending) return null

  const sourceAccount = findAccountInUser(user, source.accountId)?.account
  const sourceAccountName = sourceAccount
    ? sourceAccount.display_name?.trim() || sourceAccount.name
    : null
  const sourcePartnerLabel =
    transferPartnerLabel(sourceTransaction.other_party, sourceAccountName) ??
    t('transaction.linkedAccountUnknown')

  const confirm = () => {
    toast.promise(
      link
        .mutateAsync({
          counterpartAccountId: targetAccountId,
          counterpartTransactionId: target.id,
        })
        .then(() =>
          navigate({
            to: '/account/$accountId/transactions/$transactionId',
            params: {
              accountId: String(source.accountId),
              transactionId: String(source.transactionId),
            },
          }),
        ),
      {
        loading: t('common.saving'),
        success: t('transaction.linkSuccess'),
        error: t('transaction.linkFailed'),
      },
    )
  }

  return (
    <section className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <p className="text-sm">
        {t('transaction.linkConfirmPrompt', {
          partner: sourcePartnerLabel,
          amount: formatEuro(sourceTransaction.amount),
          date: formatDate(sourceTransaction.date),
        })}
      </p>
      <Button type="button" size="sm" disabled={link.isPending} onClick={confirm}>
        <ArrowLeftRight className="size-4" aria-hidden="true" />
        {t('transaction.linkConfirmAction')}
      </Button>
    </section>
  )
}

function TransactionNotFoundView({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-page p-4">
      <BackLink accountId={accountId} />
      <p className="text-muted-foreground mt-6 text-sm">{t('transaction.notFound')}</p>
    </main>
  )
}

export interface TransactionDetailViewProps {
  accountId: number
  transaction: TransactionDetailRead
  accountName?: string | null
  counterpartAccountName?: string | null
  onSaveNote: (note: string | null) => Promise<unknown>
  onChangeCategory: (category: TransactionCategory) => Promise<unknown>
  onUnlink: () => Promise<unknown>
  contractSection?: ReactNode
  linkSection?: ReactNode
  linkConfirmSection?: ReactNode
}

function BackLink({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/account/$accountId"
      params={{ accountId: String(accountId) }}
      aria-label={t('transaction.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}

function DetailRow({
  label,
  children,
  align = 'center',
}: {
  label: string
  children: React.ReactNode
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={cn(
        // `minmax(0,1fr)` (not `1fr`) lets the value column shrink below its
        // content's min-content width; `break-words` on the value then breaks
        // long unbreakable tokens (e.g. EREF mandate refs in a purpose) instead
        // of forcing the row wider than the viewport.
        'border-border/40 grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-t py-3 first:border-t-0',
        align === 'start' ? 'items-start' : 'items-center',
      )}
    >
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

function ContractSection({ transaction }: { transaction: TransactionRead }) {
  const { t } = useTranslation()
  const { data: contracts } = useContracts()
  const setContract = useSetTransactionContract()

  const currentId = transaction.contract_id ?? null
  const candidates = (contracts ?? []).filter(
    (contract) => contract.account_id === transaction.account_id,
  )
  const assigned = candidates.find((contract) => contract.id === currentId) ?? null

  if (!contracts) {
    return (
      <DetailRow label={t('contracts.contract')}>
        <span className="text-muted-foreground text-sm">…</span>
      </DetailRow>
    )
  }

  // Nothing to pick and not assigned: point the user at contract creation.
  if (candidates.length === 0 && currentId === null) {
    return (
      <DetailRow label={t('contracts.contract')}>
        <Link
          to="/contracts"
          className="text-primary hover:text-primary/80 text-sm transition-colors"
        >
          {t('contracts.createToAssign')}
        </Link>
      </DetailRow>
    )
  }

  const onChange = (value: string) => {
    const toContractId = value === '' ? null : Number(value)
    if (toContractId === currentId) return
    toast.promise(
      setContract.mutateAsync({
        transactionId: transaction.id,
        fromContractId: currentId,
        toContractId,
      }),
      {
        loading: t('common.saving'),
        success: toContractId === null ? t('contracts.removed') : t('contracts.assigned'),
        error: t('errors.unexpected.title'),
      },
    )
  }

  return (
    <DetailRow label={t('contracts.contract')} align="start">
      <div className="flex w-full flex-col gap-1.5">
        <SingleSelectPopover
          id="assign-contract"
          ariaLabel={t('contracts.contract')}
          value={currentId === null ? '' : String(currentId)}
          disabled={setContract.isPending}
          onChange={onChange}
          options={[
            { value: '', label: t('contracts.noContract') },
            ...candidates.map((contract) => ({
              value: String(contract.id),
              label: contract.name,
            })),
          ]}
        />
        {assigned ? (
          <Link
            to="/contracts/$contractId"
            params={{ contractId: String(assigned.id) }}
            className="text-primary hover:text-primary/80 -mx-1 self-start rounded-md px-1 py-0.5 text-sm transition-colors"
          >
            {assigned.frequency
              ? t(`contracts.frequency.${assigned.frequency}`)
              : t('contracts.frequencyUnknown')}
            {assigned.median_amount !== null ? ` · ${formatEuro(assigned.median_amount)}` : ''}
          </Link>
        ) : null}
      </div>
    </DetailRow>
  )
}
