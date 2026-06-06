import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  TRANSACTION_CATEGORIES,
  useTransaction,
  useUpdateTransaction,
  useUnlinkTransfer,
  type TransactionCategory,
} from '@/lib/transaction'
import { useAuthMe } from '@/lib/auth'
import { useDebouncedAutoSave, type AutoSaveStatus } from '@/hooks/useDebouncedAutoSave'
import { Button } from '@/components/ui/button'
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
    />
  )
}

function TransactionNotFoundView({ accountId }: { accountId: number }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-2xl p-4">
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
  /** Receives `null` when the user clears the note (per §3.4: empty = delete). */
  onSaveNote: (note: string | null) => Promise<unknown>
  onChangeCategory: (category: TransactionCategory) => Promise<unknown>
  onUnlink: () => Promise<unknown>
}

export function TransactionDetailView({
  accountId,
  transaction,
  accountName,
  counterpartAccountName,
  onSaveNote,
  onChangeCategory,
  onUnlink,
}: TransactionDetailViewProps) {
  const { t } = useTranslation()
  const negative = transaction.amount < 0

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 p-4">
      <header className="flex items-center">
        <BackLink accountId={accountId} />
      </header>

      <section className="flex min-h-[18vh] flex-col items-center justify-center">
        <p
          className={cn(
            'text-5xl font-bold tracking-tight tabular-nums',
            negative ? 'text-destructive' : 'text-success',
          )}
        >
          {formatEuro(transaction.amount)}
        </p>
        {transaction.pending ? (
          <p className="bg-muted text-muted-foreground mt-3 rounded-full px-3 py-1 text-xs font-medium">
            {t('transaction.pendingHint')}
          </p>
        ) : null}
      </section>

      <dl className="flex flex-col">
        <DetailRow label={t(otherPartyLabelKey(transaction.amount))}>
          {transaction.other_party?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow label={t('transaction.date')}>{formatDate(transaction.date)}</DetailRow>
        <DetailRow label={t('transaction.purpose')}>
          {transaction.purpose?.trim() || <EmptyValue />}
        </DetailRow>
        <DetailRow label={t('transaction.type')}>
          <TypeBadge transactionType={transaction.transaction_type} />
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
  return (
    <select
      aria-label={t('transaction.category')}
      value={value}
      disabled={pending}
      onChange={async (event) => {
        const next = event.target.value as TransactionCategory
        setPending(true)
        try {
          await onChange(next)
        } catch {
          toast.error(t('transaction.categoryUpdateFailed'))
        } finally {
          setPending(false)
        }
      }}
      className={cn(
        'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-3 disabled:opacity-50',
        'dark:bg-input/30',
      )}
    >
      {sortedOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const NOTE_URL_PATTERN =
  /(https?:\/\/[^\s]+|(?<![@\w/.])(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi

function linkifyNote(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  NOTE_URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = NOTE_URL_PATTERN.exec(text)) !== null) {
    let url = match[0]
    const trailing = url.match(/[.,;:!?)\]}'"]+$/)?.[0] ?? ''
    if (trailing) url = url.slice(0, -trailing.length)
    if (url.length === 0) continue

    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
    nodes.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="text-primary break-all underline underline-offset-2 hover:no-underline"
      >
        {url}
      </a>,
    )
    if (trailing) nodes.push(trailing)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function NoteEditor({
  remoteNote,
  onSave,
}: {
  remoteNote: string
  onSave: (note: string | null) => Promise<unknown>
}) {
  const { t } = useTranslation()
  // The draft is initialised from the loaded transaction once; route-level
  // remounts (different transactionId) reset it via React's natural unmount.
  const [draft, setDraft] = useState(remoteNote)
  // A textarea cannot host clickable links, so an empty note opens straight
  // into edit mode while an existing note is shown read-only (with linkified
  // URLs) until the user clicks into it.
  const [editing, setEditing] = useState(remoteNote.length === 0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const status = useDebouncedAutoSave({
    value: draft,
    remoteValue: remoteNote,
    // Empty textarea ⇒ delete the note on the server (spec §3.4).
    onSave: (value) => onSave(value.length === 0 ? null : value),
  })

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  if (!editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <div
          role="button"
          tabIndex={0}
          aria-label={t('transaction.noteEdit')}
          onClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          }}
          className="border-input hover:border-ring min-h-16 w-full cursor-text rounded-lg border bg-transparent px-2.5 py-1.5 text-sm whitespace-pre-wrap transition-colors dark:bg-input/30"
        >
          {draft.length === 0 ? (
            <span className="text-muted-foreground">{t('transaction.notePlaceholder')}</span>
          ) : (
            linkifyNote(draft)
          )}
        </div>
        <NoteStatus status={status} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setEditing(false)}
        placeholder={t('transaction.notePlaceholder')}
        rows={3}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-3 dark:bg-input/30"
      />
      <NoteStatus status={status} />
    </div>
  )
}

function NoteStatus({ status }: { status: AutoSaveStatus }) {
  const { t } = useTranslation()
  if (status === 'saving' || status === 'pending') {
    return <span className="text-muted-foreground text-xs">{t('transaction.noteSaving')}</span>
  }
  if (status === 'saved') {
    return <span className="text-success text-xs">{t('transaction.noteSavedAt')}</span>
  }
  return null
}
