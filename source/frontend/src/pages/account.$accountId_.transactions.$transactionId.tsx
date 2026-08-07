import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CircleHelp } from 'lucide-react'
import { toast } from 'sonner'

import type { TransactionRead } from '@/lib/accountHistory'
import { TRANSACTION_TYPE_ICONS } from '@/lib/transactionTypeIcons'
import { formatDate, formatMoney, formatIban, isIban } from '@/lib/format'
import { CategoryAvatar, useCategoryOptions } from '@/lib/categoryIcons'
import { type TransactionCategory } from '@/lib/transaction'
import { NoteEditor } from '@/components/note-editor'
import { AccountLabel } from '@/components/AccountLabel'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'
import type { TransactionDetailViewProps } from '@/routes/account.$accountId_.transactions.$transactionId'
import { BackLink } from '@/components/back-link'
import { EmptyValue } from '@/components/empty-value'

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
  bankName,
  bankIcon,
  counterpartAccountName,
  counterpartBankName,
  counterpartBankIcon,
  onSaveNote,
  onChangeCategory,
  onUnlink,
  contractSection,
  attachmentsSection,
  linkSection,
  linkConfirmSection,
}: TransactionDetailViewProps) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-8 p-4">
      <header className="flex items-center">
        <BackLink to="/account/$accountId" params={{ accountId: String(accountId) }} />
      </header>

      <section className="flex min-h-[18vh] flex-col items-center justify-center gap-4">
        <CategoryAvatar category={transaction.category} />
        <p
          className={cn(
            'text-4xl font-bold tracking-tight tabular-nums',
            negative ? 'text-destructive' : 'text-success',
          )}
        >
          {formatMoney(transaction.amount)}
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

      <dl className="grid grid-cols-[fit-content(5rem)_minmax(0,1fr)] gap-x-4 sm:grid-cols-[fit-content(11rem)_minmax(0,1fr)]">
        <DetailRow label={t(otherPartyLabelKey(transaction.amount))}>
          {transaction.other_party?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow
          label={
            <>
              <span className="sm:hidden">{t('common.purposeShort')}</span>
              <span className="hidden sm:inline">{t('common.purpose')}</span>
            </>
          }
        >
          {transaction.purpose?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow label={t('common.category')}>
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
            counterpartBankName={counterpartBankName}
            counterpartBankIcon={counterpartBankIcon}
            selfAmount={transaction.amount}
            selfDate={transaction.date}
            onUnlink={onUnlink}
          />
        ) : (
          (linkSection ?? null)
        )}
        <DetailRow label={t('common.account')}>
          {accountName?.trim() ? (
            <AccountLabel
              icon={bankIcon ?? null}
              bankName={bankName}
              accountName={accountName}
              iconClassName="size-5 rounded-[5px]"
              nameClassName="text-sm break-words"
              label={
                <Link
                  to="/account/$accountId"
                  params={{ accountId: String(accountId) }}
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  {isIban(accountName) ? formatIban(accountName) : accountName}
                </Link>
              }
            />
          ) : (
            <EmptyValue />
          )}
        </DetailRow>
        {contractSection}
        {attachmentsSection}
        {transaction.pending ? null : (
          <DetailRow label={t('common.note')} align="start">
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
  counterpartBankName,
  counterpartBankIcon,
  selfAmount,
  selfDate,
  onUnlink,
}: {
  counterpart: TransactionRead
  counterpartAccountName?: string | null
  counterpartBankName?: string | null
  counterpartBankIcon?: string | null
  selfAmount: number
  selfDate: string
  onUnlink: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const partnerLabel =
    counterpartAccountName?.trim() ||
    transferPartnerLabel(counterpart.other_party, null) ||
    t('transaction.linkedAccountUnknown')
  const parts = [partnerLabel]
  if (Math.abs(counterpart.amount) !== Math.abs(selfAmount))
    parts.push(formatMoney(counterpart.amount))
  if (counterpart.date !== selfDate) parts.push(formatDate(counterpart.date))
  const linkedLabel = parts.join(' · ')

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/account/$accountId"
          params={{ accountId: String(counterpart.account_id) }}
          search={{ focus: counterpart.id }}
          className="text-primary hover:text-primary/80 transition-colors"
        >
          <AccountLabel
            icon={counterpartBankIcon ?? null}
            bankName={counterpartBankName}
            accountName={partnerLabel}
            label={linkedLabel}
            iconClassName="size-5 rounded-[5px]"
            nameClassName="text-sm"
          />
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={handleUnlink} disabled={pending}>
          {t('transaction.unlink')}
        </Button>
      </div>
    </DetailRow>
  )
}

export function DetailRow({
  label,
  children,
  align = 'center',
}: {
  label: React.ReactNode
  children: React.ReactNode
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={cn(
        'border-border/40 col-span-2 grid grid-cols-subgrid border-t py-3 first:border-t-0',
        align === 'start' ? 'items-start' : 'items-center',
      )}
    >
      <dt className="text-muted-foreground cursor-default text-sm">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

function TypeBadge({ transactionType }: { transactionType: string }) {
  const { t } = useTranslation()
  const Icon =
    TRANSACTION_TYPE_ICONS[transactionType as keyof typeof TRANSACTION_TYPE_ICONS] ?? CircleHelp
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
      ariaLabel={t('common.category')}
      value={value}
      disabled={pending}
      onChange={(next) => void change(next)}
      options={options}
    />
  )
}
