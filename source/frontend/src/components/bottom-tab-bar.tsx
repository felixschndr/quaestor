import { Link, useRouterState } from '@tanstack/react-router'
import { Home, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ContractIcon } from '@/components/contract-icon'
import { StatsIcon } from '@/components/stats-icon'
import { useAuthMe } from '@/lib/auth'
import { useContracts } from '@/lib/contract'

const TABS = [
  { to: '/', label: 'common.overview', Icon: Home, exact: true },
  { to: '/search', label: 'common.search', Icon: Search, exact: false },
  { to: '/stats', label: 'stats.title', Icon: StatsIcon, exact: false },
  { to: '/contracts', label: 'contracts.title', Icon: ContractIcon, exact: false },
] as const

export function BottomTabBar() {
  const { t } = useTranslation()
  const { data: user } = useAuthMe()
  const { data: contracts } = useContracts()
  // Non-hidden account ids, mirrors the overview overdue badge.
  const visible = new Set(
    user?.credentials.flatMap((c) => c.accounts.filter((a) => !a.is_hidden).map((a) => a.id)) ?? [],
  )
  const overdue = (contracts ?? []).some((c) => c.is_overdue && visible.has(c.account_id))
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const accountMatch = pathname.match(/^\/account\/(\d+)/)
  const accountId = accountMatch ? Number(accountMatch[1]) : null

  return (
    <nav className="bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden">
      {TABS.map(({ to, label, Icon, exact }) => (
        <Link
          key={to}
          to={to}
          search={to !== '/' && accountId ? { account_ids: [accountId] } : undefined}
          activeOptions={{ exact }}
          className="text-muted-foreground focus-visible:ring-ring flex flex-col items-center gap-0.5 py-2 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
          activeProps={{ className: 'text-primary' }}
        >
          <span className="relative">
            <Icon className="size-5" />
            {to === '/contracts' && overdue ? (
              <span
                className="bg-warning absolute -top-0.5 -right-1 size-2 rounded-full"
                aria-hidden="true"
              />
            ) : null}
          </span>
          <span className="max-w-full truncate">{t(label)}</span>
        </Link>
      ))}
    </nav>
  )
}
