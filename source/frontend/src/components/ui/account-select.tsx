'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { accountDisplayName } from '@/lib/accounts'
import { BankLogo } from '@/components/BankLogo'
import type { AccountRead } from '@/lib/auth'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'
import type { AccountGroup } from '@/components/ui/account-select-utils'
import { handleSelectListArrowKeys } from '@/components/ui/select-list-keyboard'

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
  /** How to style the trigger when nothing is selected: 'destructive' when an empty
   *  selection means "no results" (search), 'default' when it's just an unfilled field. */
  emptyVariant?: 'destructive' | 'default'
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
  emptyVariant = 'destructive',
  header,
  groups,
  renderAccount,
}: AccountSelectPopoverProps) {
  const { t } = useTranslation()
  const listRef = usePopoverScroll<HTMLUListElement>()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-label={t('common.accounts')}
        className={cn(popoverTriggerClassName, 'justify-between', className)}
      >
        <span
          className={cn(
            'truncate',
            isEmpty && emptyVariant === 'destructive' && 'text-destructive',
          )}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0"
        onKeyDown={handleSelectListArrowKeys}
      >
        {header}
        <ul
          ref={listRef}
          aria-label={t('common.accounts')}
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
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
