import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuthMe } from '@/lib/auth'
import { useAccountGroupLayout } from '@/lib/accountGroups'
import { buildDisplayGroups, type AccountWithBank } from '@/lib/accountDisplayGroups'
import { accountDisplayName } from '@/lib/accounts'
import { formatFactorMultiplier } from '@/lib/format'

export function useDisplayGroups(accountIds: number[]) {
  const { data: user } = useAuthMe()
  const layout = useAccountGroupLayout()
  if (!user) return null
  const selectedIds = new Set(accountIds)
  return buildDisplayGroups(user, layout.data)
    .map((group) => ({
      ...group,
      accounts: group.accounts.filter((account) => selectedIds.has(account.id)),
    }))
    .filter((group) => group.accounts.length > 0)
}

type Group = { key: string; heading: string | null; accounts: AccountWithBank[] }

export function AccountGroupList({
  groups,
  renderAccount,
}: {
  groups: Group[]
  renderAccount: (account: AccountWithBank) => ReactNode
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => {
        const heading =
          group.heading === '__ungrouped__'
            ? t('credentials.groups.ungroupedHeading')
            : group.heading
        return (
          <li key={group.key} className="flex flex-col gap-1">
            {heading ? (
              <h2 className="text-muted-foreground px-2 text-xs font-semibold tracking-wide uppercase">
                {heading}
              </h2>
            ) : null}
            <ul className="flex flex-col">
              {group.accounts.map((account) => (
                <li key={account.id}>{renderAccount(account)}</li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

export function AccountLabel({ account }: { account: AccountWithBank }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="truncate text-sm font-medium">{accountDisplayName(account)}</span>
      {account.balance_factor !== 100 ? (
        <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
          x {formatFactorMultiplier(account.balance_factor / 100)}
        </span>
      ) : null}
    </span>
  )
}
