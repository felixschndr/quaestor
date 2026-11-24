import type { CSSProperties, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Checkbox } from '@/components/ui/checkbox'
import type { TransactionRead } from '@/lib/accountHistory'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

export function TransactionListItem({
  transaction,
  party,
  badges,
  subline,
  linkSearch,
  link = true,
  trailing,
  dimmed = false,
  mutedAmount = false,
  selection,
  className,
  style,
}: {
  transaction: TransactionRead
  party: string
  badges?: ReactNode
  subline?: ReactNode
  linkSearch?: { link_account_id: number; link_transaction_id: number }
  link?: boolean
  trailing?: ReactNode
  dimmed?: boolean
  mutedAmount?: boolean
  selection?: { checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }
  className?: string
  style?: CSSProperties
}) {
  const rowClassName = cn(
    'flex items-center gap-3 rounded-md transition-colors',
    (link || selection) && 'hover:bg-muted/60',
    selection && 'cursor-pointer',
    (dimmed || selection?.disabled) && 'opacity-60',
    className,
  )
  const content = (
    <>
      <CategoryAvatar category={transaction.category} className="size-8" iconClassName="size-4" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{party}</span>
          {badges}
        </span>
        {subline}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums',
          mutedAmount
            ? 'text-muted-foreground'
            : transaction.amount < 0
              ? 'text-destructive'
              : 'text-success',
        )}
      >
        {formatMoney(transaction.amount)}
      </span>
      {trailing}
    </>
  )
  return (
    <li style={style}>
      {selection ? (
        <label className={rowClassName}>
          <Checkbox
            checked={selection.checked}
            disabled={selection.disabled}
            onCheckedChange={(checked) => selection.onCheckedChange(checked === true)}
          />
          {content}
        </label>
      ) : link ? (
        <Link
          to="/transactions/$transactionId"
          params={{ transactionId: String(transaction.id) }}
          search={linkSearch}
          className={rowClassName}
        >
          {content}
        </Link>
      ) : (
        <span className={rowClassName}>{content}</span>
      )}
    </li>
  )
}
