import { type ReactNode, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  CircleHelp,
  CircleSlash,
  Coins,
  Percent,
  Receipt,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import type { TransactionDetailRead, TransactionRead } from '@/lib/accountHistory'
import { findAccountInUser } from '@/lib/accountHistory'
import { formatDate, formatEuro, formatIban, isIban } from '@/lib/format'
import { CategoryAvatar } from '@/lib/categoryIcons'
import {
  TRANSACTION_CATEGORIES,
  useTransaction,
  useUpdateTransaction,
  useUnlinkTransfer,
  type TransactionCategory,
} from '@/lib/transaction'
import { useAuthMe } from '@/lib/auth'
import { useContracts, useSetTransactionContract } from '@/lib/contract'
import { NoteEditor } from '@/components/note-editor'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/account/$accountId_/transactions/$transactionId')({
  component: TransactionDetailPage,
})

/**
 * The other-party label leans on the amount sign: outgoing → "Recipient",
 * incoming → "Sender". Falls back to the neutral combined label for the rare
 * zero-amount case (e.g. informational entries).
 */
export function otherPartyLabelKey(amount: number): string {
  if (amount < 0) return 'transaction.recipient'
  if (amount > 0) return 'transaction.sender'
  return 'transaction.otherParty'
}

function TransactionDetailPage() {
  const { accountId: rawAccountId, transactionId: rawTransactionId } = Route.useParams()
  const accountId = Number(rawAccountId)
  const transactionId = Number(rawTransactionId)
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

  return (
    <TransactionDetailView
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
    />
  )
}

function TransactionNotFoundView({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-3xl p-4">
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
}

export function TransactionDetailView({
  accountId,
  transaction,
  accountName,
  counterpartAccountName,
  onSaveNote,
  onChangeCategory,
  onUnlink,
  contractSection,
}: TransactionDetailViewProps) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 p-4">
      <header className="flex items-center">
        <BackLink accountId={accountId} />
      </header>

      <section className="flex min-h-[18vh] flex-col items-center justify-center gap-4">
        <CategoryAvatar category={transaction.category} />
        <p
          className={cn(
            'text-5xl font-bold tracking-tight tabular-nums',
            negative ? 'text-destructive' : 'text-success',
          )}
        >
          {formatEuro(transaction.amount)}
        </p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <span>{formatDate(transaction.date)}</span>
          {transaction.transaction_type ? (
            <>
              <span aria-hidden="true">·</span>
              <TypeBadge transactionType={transaction.transaction_type} />
            </>
          ) : null}
        </p>
        {transaction.pending ? (
          <p className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs font-medium">
            {t('transaction.pendingHint')}
          </p>
        ) : null}
      </section>

      <dl className="flex flex-col">
        <DetailRow label={t(otherPartyLabelKey(transaction.amount))}>
          {transaction.other_party?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow label={t('transaction.purpose')}>
          {transaction.purpose?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow label={t('transaction.category')}>
          {transaction.pending ? (
            <span className="text-sm">{t(`category.${transaction.category}`)}</span>
          ) : (
            <CategorySelect
              value={transaction.category as TransactionCategory}
              onChange={onChangeCategory}
            />
          )}
        </DetailRow>
        {transaction.transfer_counterpart ? (
          <LinkedTransactionSection
            counterpart={transaction.transfer_counterpart}
            counterpartAccountName={counterpartAccountName}
            onUnlink={onUnlink}
          />
        ) : null}
        {contractSection}
        <DetailRow label={t('transaction.account')}>
          {accountName?.trim() ? (
            <Link
              to="/account/$accountId"
              params={{ accountId: String(accountId) }}
              className="text-primary hover:text-primary/80 transition-colors"
            >
              {isIban(accountName) ? formatIban(accountName) : accountName}
            </Link>
          ) : (
            <EmptyValue />
          )}
        </DetailRow>
        {transaction.pending ? null : (
          <DetailRow label={t('transaction.note')} align="start">
            <NoteEditor remoteNote={transaction.note ?? ''} onSave={onSaveNote} />
          </DetailRow>
        )}
      </dl>
    </main>
  )
}

function LinkedTransactionSection({
  counterpart,
  counterpartAccountName,
  onUnlink,
}: {
  counterpart: TransactionRead
  counterpartAccountName?: string | null
  onUnlink: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const accountLabel = counterpartAccountName?.trim() || t('transaction.linkedAccountUnknown')

  const handleUnlink = async () => {
    setPending(true)
    try {
      await onUnlink()
    } catch {
      toast.error(t('transaction.unlinkFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <DetailRow label={t('transaction.linkedTransaction')} align="start">
      <div className="flex flex-col items-start gap-2">
        <Link
          to="/account/$accountId"
          params={{ accountId: String(counterpart.account_id) }}
          search={{ focus: counterpart.id }}
          className="text-primary hover:text-primary/80 inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeftRight className="size-4" aria-hidden="true" />
          <span>
            {t('transaction.linkedTransactionValue', {
              account: accountLabel,
              amount: formatEuro(counterpart.amount),
              date: formatDate(counterpart.date),
            })}
          </span>
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={handleUnlink} disabled={pending}>
          {t('transaction.unlink')}
        </Button>
      </div>
    </DetailRow>
  )
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

function EmptyValue() {
  const { t } = useTranslation()
  return <span className="text-muted-foreground">{t('transaction.fieldEmpty')}</span>
}

function TypeBadge({ transactionType }: { transactionType: string | null }) {
  const { t } = useTranslation()
  if (!transactionType) return <EmptyValue />
  const Icon = TRANSACTION_TYPE_ICONS[transactionType] ?? CircleHelp
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="text-muted-foreground size-4" aria-hidden="true" />
      <span className="text-sm">{t(`transactionType.${transactionType}`)}</span>
    </span>
  )
}

// Mirrors `source/backend/models/transaction_type.py`. Unmapped values fall
// back to a question-mark icon so a future enum value still renders.
const TRANSACTION_TYPE_ICONS: Record<string, LucideIcon> = {
  INCOMING: ArrowDownLeft,
  OUTGOING: ArrowUpRight,
  BUY: TrendingUp,
  SELL: TrendingDown,
  DEPOSIT: ArrowDownLeft,
  REMOVAL: ArrowUpRight,
  DIVIDEND: Percent,
  INTEREST: Percent,
  INTEREST_CHARGE: Percent,
  TAXES: Receipt,
  TAX_REFUND: Receipt,
  FEES: Coins,
  FEES_REFUND: Coins,
  TRANSFER_IN: ArrowDownLeft,
  TRANSFER_OUT: ArrowUpRight,
  ZERO: CircleSlash,
}

function CategorySelect({
  value,
  onChange,
}: {
  value: TransactionCategory
  onChange: (category: TransactionCategory) => Promise<unknown>
}) {
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState(false)
  // Sort categories alphabetically by their localised label; UNKNOWN is pinned
  // last so it doesn't get accidentally picked when scrolling the dropdown.
  const sortedOptions = useMemo(() => {
    const localised = TRANSACTION_CATEGORIES.filter((category) => category !== 'UNKNOWN').map(
      (category) => ({ value: category, label: t(`category.${category}`) }),
    )
    localised.sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    return [...localised, { value: 'UNKNOWN' as TransactionCategory, label: t('category.UNKNOWN') }]
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
      ariaLabel={t('transaction.category')}
      value={value}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={sortedOptions}
    />
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
