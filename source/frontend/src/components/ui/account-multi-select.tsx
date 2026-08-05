'use client'

import { useTranslation } from 'react-i18next'

import { useAccountGroupLayout } from '@/lib/accountGroups'
import { defaultAccountIds } from '@/lib/accounts'
import type { CredentialRead } from '@/lib/auth'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectAllHeader } from '@/components/ui/select-all-header'
import { AccountOptionContent, AccountSelectPopover } from '@/components/ui/account-select'
import { accountOptionRowClass, groupAccounts } from '@/components/ui/account-select-utils'

export interface AccountMultiSelectProps {
  id?: string
  credentials: CredentialRead[]
  selectedIds: number[]
  onChange: (next: number[]) => void
  className?: string
}

function AccountMultiSelect({
  id,
  credentials,
  selectedIds,
  onChange,
  className,
}: AccountMultiSelectProps) {
  const { t } = useTranslation()
  const layout = useAccountGroupLayout()
  const groups = groupAccounts(credentials, layout.data)
  const allIds = groups.flatMap((group) => group.accounts.map((account) => account.id))
  const defaultIds = defaultAccountIds(credentials)
  const hasNonDefaultAccount = defaultIds.length < allIds.length
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
        <SelectAllHeader
          countLabel={t('search.accountsCount', { count: selectedCount })}
          allLabel={t('search.selectAll')}
          noneLabel={t('search.selectNone')}
          onAll={() => onChange(allIds)}
          onNone={() => onChange([])}
          defaultLabel={hasNonDefaultAccount ? t('search.selectDefault') : undefined}
          onDefault={hasNonDefaultAccount ? () => onChange(defaultIds) : undefined}
        />
      }
      renderHeading={(group, heading) => {
        const ids = group.accounts.map((account) => account.id)
        const selectedInGroup = ids.filter((id) => selectedSet.has(id)).length
        const checked =
          selectedInGroup === 0 ? false : selectedInGroup === ids.length ? true : 'indeterminate'
        const checkboxId = `account-group-${group.key}`
        const toggleGroup = () => {
          const next = new Set(selectedSet)
          if (selectedInGroup === ids.length) ids.forEach((id) => next.delete(id))
          else ids.forEach((id) => next.add(id))
          onChange([...next])
        }
        return (
          <label
            htmlFor={checkboxId}
            className="hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-md px-2 pt-2 pb-1"
          >
            <h3 className="text-muted-foreground flex-1 text-xs font-semibold tracking-wide uppercase">
              {heading}
            </h3>
            <Checkbox
              id={checkboxId}
              data-select-row=""
              checked={checked}
              onCheckedChange={toggleGroup}
            />
          </label>
        )
      }}
      renderAccount={(account) => {
        const checkboxId = `account-multi-${account.id}`
        return (
          <label key={account.id} htmlFor={checkboxId} className={accountOptionRowClass}>
            <AccountOptionContent account={account} />
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
