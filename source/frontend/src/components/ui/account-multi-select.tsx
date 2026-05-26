'use client'

import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { bankIconUrl, groupAccountsByBank } from '@/lib/accounts'
import { formatIban } from '@/lib/format'
import type { CredentialRead } from '@/lib/auth'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface AccountMultiSelectProps {
  id?: string
  credentials: CredentialRead[]
  selectedIds: number[]
  onChange: (next: number[]) => void
  className?: string
}

/**
 * Popover with the full list of the user's accounts, grouped by bank like on
 * the overview page. Each row is a checkbox; the header offers "All" / "None"
 * shortcuts. Selection state is fully controlled by the parent (passed as
 * `selectedIds` + `onChange`).
 */
function AccountMultiSelect({
  id,
  credentials,
  selectedIds,
  onChange,
  className,
}: AccountMultiSelectProps) {
  const { t } = useTranslation()
  const groups = groupAccountsByBank(credentials)
  const allIds = groups.flatMap((group) => group.accounts.map((account) => account.id))
  const selectedSet = new Set(selectedIds)
  const selectedCount = selectedIds.length
  const totalCount = allIds.length
  const allSelected = totalCount > 0 && selectedCount === totalCount

  const triggerLabel =
    selectedCount === 0
      ? t('search.accountsNone')
      : allSelected
        ? t('search.accountsAll')
        : t('search.accountsCount', { count: selectedCount })

  const toggle = (accountId: number) => {
    const next = new Set(selectedSet)
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    onChange([...next])
  }

  return (
    <Popover>
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
        <span className={cn('truncate', selectedCount === 0 && 'text-muted-foreground')}>
          {triggerLabel}
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <div className="border-border/40 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('search.accountsCount', { count: selectedCount })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-primary hover:text-primary/80 rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange(allIds)}
            >
              {t('search.selectAll')}
            </button>
            <button
              type="button"
              className="text-primary hover:text-primary/80 rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange([])}
            >
              {t('search.selectNone')}
            </button>
          </div>
        </div>
        <ul aria-label={t('search.accountsLabel')} className="max-h-72 overflow-y-auto py-1">
          {groups.map((group) => (
            <li key={group.bank} className="flex flex-col">
              {group.accounts.map((account) => {
                const checkboxId = `account-multi-${account.id}`
                const checked = selectedSet.has(account.id)
                return (
                  <label
                    key={account.id}
                    htmlFor={checkboxId}
                    className="hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
                  >
                    <img
                      src={bankIconUrl(group.bank)}
                      alt=""
                      aria-hidden="true"
                      className="size-5 shrink-0 rounded-sm object-cover"
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                    <span className="flex-1 truncate">{formatIban(account.name)}</span>
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      onCheckedChange={() => toggle(account.id)}
                    />
                  </label>
                )
              })}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export { AccountMultiSelect }
