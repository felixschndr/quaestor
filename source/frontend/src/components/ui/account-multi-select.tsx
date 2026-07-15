'use client'

import { useTranslation } from 'react-i18next'

import { useAccountGroupLayout } from '@/lib/accountGroups'
import type { CredentialRead } from '@/lib/auth'
import { Checkbox } from '@/components/ui/checkbox'
import { AccountOptionContent, AccountSelectPopover } from '@/components/ui/account-select'
import { accountOptionRowClass, groupAccountsByBank } from '@/components/ui/account-select-utils'

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
 * shortcuts. Selection state is fully controlled by the parent.
 */
function AccountMultiSelect({
  id,
  credentials,
  selectedIds,
  onChange,
  className,
}: AccountMultiSelectProps) {
  const { t } = useTranslation()
  const layout = useAccountGroupLayout()
  const groups = groupAccountsByBank(credentials, layout.data)
  const allIds = groups.flatMap((group) => group.accounts.map((account) => account.id))
  const selectedSet = new Set(selectedIds)
  const selectedCount = selectedIds.length
  const allSelected = allIds.length > 0 && selectedCount === allIds.length

  const triggerLabel =
    selectedCount === 0
      ? t('search.accountsNone')
      : allSelected
        ? t('common.allAccounts')
        : t('search.accountsCount', { count: selectedCount })

  const toggle = (accountId: number) => {
    const next = new Set(selectedSet)
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    onChange([...next])
  }

  return (
    <AccountSelectPopover
      id={id}
      className={className}
      triggerLabel={triggerLabel}
      isEmpty={selectedCount === 0}
      groups={groups}
      header={
        <div className="border-border/40 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('search.accountsCount', { count: selectedCount })}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-primary hover:text-primary/80 cursor-pointer rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange(allIds)}
            >
              {t('search.selectAll')}
            </button>
            <button
              type="button"
              className="text-primary hover:text-primary/80 cursor-pointer rounded-md px-2 py-0.5 transition-colors"
              onClick={() => onChange([])}
            >
              {t('search.selectNone')}
            </button>
          </div>
        </div>
      }
      renderAccount={(account, group) => {
        const checkboxId = `account-multi-${account.id}`
        return (
          <label key={account.id} htmlFor={checkboxId} className={accountOptionRowClass}>
            <AccountOptionContent group={group} account={account} />
            <Checkbox
              id={checkboxId}
              data-select-row=""
              checked={selectedSet.has(account.id)}
              onCheckedChange={() => toggle(account.id)}
            />
          </label>
        )
      }}
    />
  )
}

export { AccountMultiSelect }
