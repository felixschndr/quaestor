import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, ChevronLeft, CircleHelp } from 'lucide-react'
import { toast } from 'sonner'

import type { TransactionRead } from '@/lib/accountHistory'
import { TRANSACTION_TYPE_ICONS } from '@/lib/transactionTypeIcons'
import { formatDate, formatEuro, formatIban, isIban } from '@/lib/format'
import { CategoryAvatar, useCategoryOptions } from '@/lib/categoryIcons'
import { type TransactionCategory } from '@/lib/transaction'
import { NoteEditor } from '@/components/note-editor'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'
import type { TransactionDetailViewProps } from '@/routes/account.$accountId_.transactions.$transactionId'

export function otherPartyLabelKey(amount: number): string {
  if (amount < 0) return 'transaction.recipient'
  if (amount > 0) return 'transaction.sender'
  return 'transaction.otherParty'
}

export function transferPartnerLabel(
  otherParty: string | null | undefined,
  accountName: string | null | undefined,
): string | null {
  const party = otherParty?.trim()
  if (party) return formatIban(party)
  const account = accountName?.trim()
  return account ? formatIban(account) : null
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
  linkSection,
  linkConfirmSection,
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

      {linkConfirmSection}

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
        ) : (
          (linkSection ?? null)
        )}
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
  const partnerLabel =
    transferPartnerLabel(counterpart.other_party, counterpartAccountName) ??
    t('transaction.linkedAccountUnknown')

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
              partner: partnerLabel,
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

function CategorySelect({
  value,
  onChange,
}: {
  value: TransactionCategory
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
      ariaLabel={t('transaction.category')}
      value={value}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={options}
    />
  )
}
