'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useWheelScroll } from '@/lib/use-wheel-scroll'
import { accountDisplayName } from '@/lib/accounts'
import { BankLogo } from '@/components/BankLogo'
import type { AccountRead } from '@/lib/auth'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { AccountGroup } from '@/components/ui/account-select-utils'

/** Bank logo + account name — the part of a row that's identical across single/multi select. */
export function AccountOptionContent({
  group,
  account,
}: {
  group: AccountGroup
  account: AccountRead
}) {
  return (
    <>
      <BankLogo icon={group.icon} name={group.name} seed={group.name} className="size-5 shrink-0" />
      <span className="flex-1 truncate">{accountDisplayName(account)}</span>
    </>
  )
}

export interface AccountSelectPopoverProps {
  id?: string
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerLabel: ReactNode
  isEmpty: boolean
  header?: ReactNode
  groups: AccountGroup[]
  renderAccount: (account: AccountRead, group: AccountGroup) => ReactNode
}

/** Popover shell with the bank-grouped account list; the trigger label, optional header and
 *  per-row control are supplied by the single- or multi-select wrapper. */
export function AccountSelectPopover({
  id,
  className,
  open,
  onOpenChange,
  triggerLabel,
  isEmpty,
  header,
  groups,
  renderAccount,
}: AccountSelectPopoverProps) {
  const { t } = useTranslation()
  const listRef = useWheelScroll<HTMLUListElement>()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={t('search.accountsLabel')}
        className={cn(
          'border-input flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 py-1 text-left text-sm transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          'aria-expanded:border-ring',
          'dark:bg-input/30',
          className,
        )}
      >
        <span className={cn('truncate', isEmpty && 'text-muted-foreground')}>{triggerLabel}</span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0">
        {header}
        <ul
          ref={listRef}
          aria-label={t('search.accountsLabel')}
          className="max-h-72 overflow-y-auto py-1"
        >
          {groups.map((group) => (
            <li key={group.key} className="flex flex-col">
              {group.accounts.map((account) => renderAccount(account, group))}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
