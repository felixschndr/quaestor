import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CircleHelp, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import type { TransactionRead } from '@/lib/accountHistory'
import { TRANSACTION_TYPE_ICONS } from '@/lib/transactionTypeIcons'
import { formatDate, formatDateCompact, formatMoney, formatIban, isIban } from '@/lib/format'
import { CategoryAvatar, useCategoryOptions } from '@/lib/categoryIcons'
import { type TransactionCategory } from '@/lib/transaction'
import { NoteEditor } from '@/components/note-editor'
import { AccountLabel } from '@/components/AccountLabel'
import { RowActions } from '@/components/row-actions'
import { Button } from '@/components/ui/button'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'
import type {
  FlowMemberView,
  TransactionDetailViewProps,
} from '@/routes/account.$accountId_.transactions.$transactionId'
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
  flowMembers,
  linking,
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
        <BackLink to="/account/$accountId" params={{ accountId: String(accountId) }}>
          {accountName ?? t('common.back')}
        </BackLink>
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
        {flowMembers.length > 0 || linkSection ? (
          <FlowSection
            members={flowMembers}
            onUnlink={onUnlink}
            linkAction={linkSection}
            canUnlink={!linking}
          />
        ) : null}
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

function FlowSection({
  members,
  onUnlink,
  linkAction,
  canUnlink = true,
}: {
  members: FlowMemberView[]
  onUnlink: (transaction: TransactionRead) => Promise<unknown>
  linkAction?: React.ReactNode
  canUnlink?: boolean
}) {
  const { t } = useTranslation()

  return (
    <DetailRow label={t('transaction.flow')} align="start">
      <div className="flex w-full flex-col gap-3">
        {members.length > 0 ? (
          <ol className="flex flex-col">
            {members.map((member, index) => (
              <FlowTimelineRow
                key={member.transaction.id}
                member={member}
                isFirst={index === 0}
                isLast={index === members.length - 1}
                onRemove={canUnlink ? () => onUnlink(member.transaction) : undefined}
              />
            ))}
          </ol>
        ) : null}
        {linkAction}
      </div>
    </DetailRow>
  )
}

function FlowTimelineRow({
  member,
  isFirst,
  isLast,
  onRemove,
}: {
  member: FlowMemberView
  isFirst: boolean
  isLast: boolean
  onRemove?: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const { transaction, accountName, bankName, bankIcon, isCurrent } = member

  const handleRemove = async () => {
    setPending(true)
    try {
      await onRemove?.()
    } catch {
      toast.error(t('transaction.unlinkFailed'))
    } finally {
      setPending(false)
    }
  }

  const removeButton = onRemove ? (
    <RowActions
      onDelete={handleRemove}
      deleting={pending}
      confirmLabel={t('transaction.removeFromFlow')}
      renderTrigger={(confirm) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={confirm}
          aria-label={t('transaction.removeFromFlow')}
        >
          <Unlink className="size-4" aria-hidden="true" />
        </Button>
      )}
    />
  ) : null
  const partnerLabel =
    accountName?.trim() ||
    transferPartnerLabel(transaction.other_party, null) ||
    t('transaction.linkedAccountUnknown')

  const otherParty = transaction.other_party?.trim()
  const purpose = transaction.purpose?.trim()
  const details = [
    otherParty && formatIban(otherParty) !== partnerLabel ? formatIban(otherParty) : null,
    purpose || null,
  ]
    .filter(Boolean)
    .join(' · ')

  const account = (
    <AccountLabel
      icon={bankIcon ?? null}
      bankName={bankName}
      accountName={partnerLabel}
      iconClassName="size-5 rounded-[5px]"
      nameClassName={cn('truncate text-sm', isCurrent && 'font-medium')}
    />
  )

  return (
    <li className="flex gap-3">
      <div className="relative w-3 shrink-0 self-stretch" aria-hidden="true">
        <span
          className={cn(
            'bg-border absolute left-1/2 w-px -translate-x-1/2',
            isFirst ? 'top-1/2' : 'top-0',
            isLast ? 'bottom-1/2' : 'bottom-0',
          )}
        />
        <span
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
            isCurrent
              ? 'bg-primary ring-primary ring-offset-background size-2 ring-2 ring-offset-1'
              : 'border-muted-foreground/40 bg-background size-2.5 border-2',
          )}
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
        <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
          {formatDateCompact(transaction.date)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {isCurrent ? (
            account
          ) : (
            <Link
              to="/account/$accountId"
              params={{ accountId: String(transaction.account_id) }}
              search={{ focus: transaction.id }}
              className="text-primary hover:text-primary/80 min-w-0 transition-colors"
            >
              {account}
            </Link>
          )}
          {details ? (
            <span className="text-muted-foreground truncate text-xs">{details}</span>
          ) : null}
        </div>
        {removeButton ? <span className="ml-auto shrink-0">{removeButton}</span> : null}
      </div>
    </li>
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
