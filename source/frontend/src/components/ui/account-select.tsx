'use client'

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { usePopoverScroll } from '@/lib/use-popover-scroll'
import { accountDisplayName } from '@/lib/accounts'
import { BankLogo } from '@/components/BankLogo'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverTriggerClassName,
} from '@/components/ui/popover'
import type { AccountGroup } from '@/components/ui/account-select-utils'
import type { AccountWithBank } from '@/lib/accountDisplayGroups'
import { handleSelectListArrowKeys } from '@/components/ui/select-list-keyboard'

export function AccountOptionContent({ account }: { account: AccountWithBank }) {
  return (
    <>
      <BankLogo
        icon={account.bankIcon}
        name={account.bankName ?? account.bank}
        seed={account.bankName ?? account.bank}
        className="size-5 shrink-0"
      />
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
  emptyVariant?: 'destructive' | 'default'
  header?: ReactNode
  groups: AccountGroup[]
  renderAccount: (account: AccountWithBank, group: AccountGroup) => ReactNode
  renderHeading?: (group: AccountGroup, heading: string) => ReactNode
}

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
  renderHeading,
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
          {groups.map((group) => {
            const heading =
              group.heading === '__ungrouped__'
                ? t('credentials.groups.ungroupedHeading')
                : group.heading
            return (
              <li key={group.key} className="flex flex-col">
                {heading != null
                  ? (renderHeading?.(group, heading) ?? (
                      <h3 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
                        {heading}
                      </h3>
                    ))
                  : null}
                {group.accounts.map((account) => renderAccount(account, group))}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
