'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { accountDisplayName } from '@/lib/accounts'
import { useAccountGroupLayout } from '@/lib/accountGroups'
import type { CredentialRead } from '@/lib/auth'
import { AccountOptionContent, AccountSelectPopover } from '@/components/ui/account-select'
import { accountOptionRowClass, groupAccountsByBank } from '@/components/ui/account-select-utils'

export interface AccountSingleSelectProps {
  id?: string
  credentials: CredentialRead[]
  value: number | null
  onChange: (next: number) => void
  placeholder?: string
  className?: string
}

/** Single-account variant of {@link AccountMultiSelect}: picking a row selects it and closes. */
function AccountSingleSelect({
  id,
  credentials,
  value,
  onChange,
  placeholder,
  className,
}: AccountSingleSelectProps) {
  const [open, setOpen] = useState(false)
  const layout = useAccountGroupLayout()
  const groups = groupAccountsByBank(credentials, layout.data)
  const selectedAccount =
    groups.flatMap((group) => group.accounts).find((account) => account.id === value) ?? null

  return (
    <AccountSelectPopover
      id={id}
      className={className}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={selectedAccount ? accountDisplayName(selectedAccount) : (placeholder ?? '')}
      isEmpty={!selectedAccount}
      groups={groups}
      renderAccount={(account, group) => (
        <button
          key={account.id}
          type="button"
          onClick={() => {
            onChange(account.id)
            setOpen(false)
          }}
          className={cn(accountOptionRowClass, 'text-left')}
        >
          <AccountOptionContent group={group} account={account} />
          {account.id === value ? (
            <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
          ) : null}
        </button>
      )}
    />
  )
}

export { AccountSingleSelect }
