import { Link, getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { BackLink } from '@/components/back-link'
import { BankLogo } from '@/components/BankLogo'
import {
  AccountGroupList,
  AccountLabel,
  useDisplayGroups,
} from '@/components/stats/account-group-list'
import { sumFactoredBalance } from '@/lib/accountDisplayGroups'
import { formatMoney } from '@/lib/format'

const balanceRoute = getRouteApi('/stats_/balance')

export function AccountBalancesPage() {
  const search = balanceRoute.useSearch()
  const { t } = useTranslation()
  const groups = useDisplayGroups(search.account_ids ?? [])

  if (!groups) return null // root guard already redirected on 401

  const total = sumFactoredBalance(groups.flatMap((group) => group.accounts))

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/stats" />
        <h1 className="text-foreground flex-1 text-lg font-semibold">{t('stats.balance.title')}</h1>
      </header>

      {groups.length === 0 ? (
        <p className="border-border bg-card rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('stats.balance.empty')}
        </p>
      ) : (
        <>
          <AccountGroupList
            groups={groups}
            renderAccount={(account) => (
              <Link
                to="/account/$accountId"
                params={{ accountId: String(account.id) }}
                className="hover:bg-muted/60 focus-visible:ring-ring flex items-center gap-3 rounded-md px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <BankLogo
                  icon={account.bankIcon}
                  name={account.bankName ?? account.bank}
                  seed={account.bankName ?? account.bank}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <AccountLabel account={account} />
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(account.balance)}
                </span>
              </Link>
            )}
          />

          <div className="border-border mx-2 flex items-center justify-between border-t pt-3 text-sm font-semibold tabular-nums">
            <span>{t('common.total')}</span>
            <span>{formatMoney(total)}</span>
          </div>
        </>
      )}
    </main>
  )
}
