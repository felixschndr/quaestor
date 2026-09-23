import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowDownLeft, ArrowUpRight, CircleHelp, RotateCcw, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import type { TransactionRead } from '@/lib/accountHistory'
import { TRANSACTION_TYPE_ICONS } from '@/lib/transactionTypeIcons'
import {
  formatDate,
  formatDateCompact,
  formatDateShortWeekdayWithoutYear,
  formatDateWithoutYear,
  formatMoney,
  formatIban,
  isIban,
} from '@/lib/format'
import { CategoryAvatar, useCategoryOptions } from '@/lib/categoryIcons'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import { type CategoryKey } from '@/lib/transaction'
import { NoteEditor } from '@/components/note-editor'
import { AccountLabel } from '@/components/AccountLabel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { cn } from '@/lib/utils'
import type {
  RelatedTransactionView,
  TransactionDetailViewProps,
} from '@/routes/transactions.$transactionId'
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
  relatedTransactions,
  linking,
  canWrite = true,
  canUnlink = true,
  onSaveNote,
  onChangeCategory,
  onUnlink,
  ruleSection,
  contractSection,
  attachmentsSection,
  linkSection,
  linkConfirmSection,
}: TransactionDetailViewProps) {
  const { t } = useTranslation()
  const catalog = useCategoryCatalog()
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
        <p className="text-muted-foreground flex flex-col items-center gap-1.5 text-sm sm:flex-row">
          <span>{formatDate(transaction.date)}</span>
          {transaction.transaction_type ? (
            <>
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
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
          {transaction.pending || !canWrite ? (
            <span className="text-sm">{catalog.label(transaction.category)}</span>
          ) : (
            <CategorySelect
              value={transaction.category as CategoryKey}
              manual={transaction.category_source === 'MANUAL'}
              includeCustom={canUnlink}
              onChange={onChangeCategory}
            >
              {ruleSection}
            </CategorySelect>
          )}
        </DetailRow>
        {relatedTransactions.length > 0 || linkSection ? (
          <RelatedSection
            members={relatedTransactions}
            onUnlink={onUnlink}
            linkAction={linkSection}
            canUnlink={canUnlink && !linking}
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
            {canWrite ? (
              <NoteEditor remoteNote={transaction.note ?? ''} onSave={onSaveNote} />
            ) : (
              <span className="text-sm break-words">
                {transaction.note?.trim() || <EmptyValue />}
              </span>
            )}
          </DetailRow>
        )}
      </dl>
    </main>
  )
}

function RelatedSection({
  members,
  onUnlink,
  linkAction,
  canUnlink = true,
}: {
  members: RelatedTransactionView[]
  onUnlink: (transaction: TransactionRead) => Promise<unknown>
  linkAction?: React.ReactNode
  canUnlink?: boolean
}) {
  const { t } = useTranslation()

  const showUnlink = canUnlink && members.length > 0
  const showAmount = new Set(members.map((member) => Math.abs(member.transaction.amount))).size > 1

  const dedupe = (values: string[]) => Array.from(new Set(values))
  const relatedDates = dedupe(
    members.map((member) => formatDateShortWeekdayWithoutYear(member.transaction.date)),
  )

  return (
    <DetailRow label={t('common.relatedTransactions')} align="start">
      <div className="flex w-full flex-col gap-3">
        {members.length > 0 ? (
          <ol className="flex flex-col">
            {members.map((member, index) => (
              <RelatedTimelineRow
                key={member.transaction.id}
                member={member}
                isFirst={index === 0}
                isLast={index === members.length - 1}
                showAmount={showAmount}
                relatedDates={relatedDates}
              />
            ))}
          </ol>
        ) : null}
        {linkAction || showUnlink ? (
          <div
            className={cn(
              'grid auto-cols-fr grid-flow-col gap-2 sm:flex sm:flex-wrap',
              members.length > 0 && 'sm:ml-6',
            )}
          >
            {linkAction}
            {showUnlink ? <UnlinkMenu members={members} onUnlink={onUnlink} /> : null}
          </div>
        ) : null}
      </div>
    </DetailRow>
  )
}

function partnerLabelOf(member: RelatedTransactionView, unknownLabel: string): string {
  return (
    member.accountName?.trim() ||
    transferPartnerLabel(member.transaction.other_party, null) ||
    unknownLabel
  )
}

function UnlinkMenu({
  members,
  onUnlink,
}: {
  members: RelatedTransactionView[]
  onUnlink: (transaction: TransactionRead) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [pending, setPending] = useState(false)

  const remove = async (transaction: TransactionRead) => {
    setPending(true)
    try {
      await onUnlink(transaction)
      setOpen(false)
    } catch {
      toast.error(t('transaction.unlinkFailed'))
    } finally {
      setPending(false)
      setConfirmingId(null)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirmingId(null)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('transaction.removeFromRelated')}
        >
          <Unlink className="size-4" aria-hidden="true" />
          <span className="sm:hidden">{t('transaction.removeFromRelatedShort')}</span>
          <span className="hidden sm:inline">{t('transaction.removeFromRelated')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-1rem)] p-1">
        <ul aria-label={t('transaction.removeFromRelated')} className="flex flex-col">
          {members.map((member) => (
            <li key={member.transaction.id} className="flex flex-col gap-2 p-1">
              <button
                type="button"
                aria-expanded={confirmingId === member.transaction.id}
                onClick={() =>
                  setConfirmingId((current) =>
                    current === member.transaction.id ? null : member.transaction.id,
                  )
                }
                className="hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left outline-none"
              >
                <span className="min-w-0 text-sm">
                  <span className="block truncate">
                    {partnerLabelOf(member, t('transaction.linkedAccountUnknown'))}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDateCompact(member.transaction.date)} ·{' '}
                    {formatMoney(member.transaction.amount)}
                  </span>
                </span>
              </button>
              {confirmingId === member.transaction.id ? (
                <div className="grid grid-cols-2 gap-2 px-1 pb-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => void remove(member.transaction)}
                  >
                    {t('transaction.removeFromRelatedShort')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setConfirmingId(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function RelatedTimelineRow({
  member,
  isFirst,
  isLast,
  showAmount,
  relatedDates,
}: {
  member: RelatedTransactionView
  isFirst: boolean
  isLast: boolean
  showAmount: boolean
  relatedDates: string[]
}) {
  const { t } = useTranslation()
  const { transaction, bankName, bankIcon, isCurrent, isAccessible } = member
  const linkable = !isCurrent && isAccessible
  const incoming = transaction.amount > 0
  const DirectionIcon = incoming ? ArrowDownLeft : ArrowUpRight

  const partnerLabel = partnerLabelOf(member, t('transaction.linkedAccountUnknown'))

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

  const timeline = (
    <>
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
    </>
  )
  const timelineClassName = 'relative w-3 shrink-0 self-stretch'

  return (
    <li className="flex gap-3">
      {!linkable ? (
        <div className={timelineClassName} aria-hidden="true">
          {timeline}
        </div>
      ) : (
        <Link
          to="/transactions/$transactionId"
          params={{ transactionId: String(transaction.id) }}
          className={cn(timelineClassName, 'block')}
          aria-hidden="true"
          tabIndex={-1}
        >
          {timeline}
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
            <span className="sm:hidden">{formatDateWithoutYear(transaction.date)}</span>
            <span className="hidden sm:inline-grid">
              {relatedDates.map((date) => (
                <span key={date} aria-hidden="true" className="invisible col-start-1 row-start-1">
                  {date}
                </span>
              ))}
              <span className="col-start-1 row-start-1">
                {formatDateShortWeekdayWithoutYear(transaction.date)}
              </span>
            </span>
          </span>
          <DirectionIcon
            className={cn(
              'hidden size-4 shrink-0 sm:block',
              incoming ? 'text-success' : 'text-destructive',
            )}
            aria-label={t(incoming ? 'transaction.incoming' : 'transaction.outgoing')}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {!linkable ? (
            account
          ) : (
            <Link
              to="/transactions/$transactionId"
              params={{ transactionId: String(transaction.id) }}
              className="text-primary hover:text-primary/80 min-w-0 transition-colors"
            >
              {account}
            </Link>
          )}
          {showAmount || details ? (
            <span className="text-muted-foreground truncate text-xs">
              {showAmount ? (
                <span
                  className={cn('tabular-nums', incoming ? 'text-success' : 'text-destructive')}
                >
                  {formatMoney(transaction.amount)}
                </span>
              ) : null}
              {showAmount && details ? ' · ' : null}
              {details}
            </span>
          ) : null}
        </div>
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
      <span className="text-sm">{t(`common.transactionLabel.${transactionType}`)}</span>
    </span>
  )
}

function CategorySelect({
  value,
  manual,
  includeCustom,
  onChange,
  children,
}: {
  value: CategoryKey
  manual: boolean
  includeCustom?: boolean
  onChange: (category: CategoryKey | null) => Promise<unknown>
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const options = useCategoryOptions({ includeCustom })

  const change = async (next: CategoryKey | null) => {
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
    <div className="flex flex-wrap items-center gap-2">
      <SingleSelectPopover
        ariaLabel={t('common.category')}
        value={value}
        disabled={pending}
        onChange={(next) => void change(next)}
        options={options}
        searchPlaceholder={t('search.filterPlaceholder')}
        className="w-full sm:w-auto sm:flex-1"
      />
      {/* Without buttons this row must not exist at all, it would only add its gap */}
      {manual || children ? (
        <div
          className={cn(
            'grid w-full gap-2 sm:contents',
            manual && children ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          {manual ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void change(null)}
              className="min-w-0 sm:flex-none"
            >
              <RotateCcw className="hidden size-4 sm:block" aria-hidden="true" />
              {t('transaction.categoryReset')}
            </Button>
          ) : null}
          {children ? (
            <span className="flex min-w-0 sm:ml-auto sm:flex-none">{children}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
