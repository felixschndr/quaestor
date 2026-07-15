import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Repeat } from 'lucide-react'

import { sumContractsForPeriod, useContracts } from '@/lib/contract'
import { formatEuro } from '@/lib/format'

export function ContractsSummaryCard({ accountIds }: { accountIds: number[] }) {
  const { t } = useTranslation()
  const { data } = useContracts()
  const contracts = (data ?? []).filter((contract) => accountIds.includes(contract.account_id))

  if (contracts.length === 0) return null

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-primary inline-flex items-center gap-2 text-sm font-semibold">
          <Repeat className="size-4" aria-hidden="true" />
          {t('contracts.title')}
        </h2>
        <Link
          to="/contracts"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm transition-colors"
        >
          {t('stats.contracts.viewAll')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </header>
      <div className="grid grid-cols-3 gap-2">
        <Metric
          label={t('stats.contracts.perDay')}
          value={formatEuro(sumContractsForPeriod(contracts, 'DAY'))}
        />
        <Metric
          label={t('stats.contracts.perMonth')}
          value={formatEuro(sumContractsForPeriod(contracts, 'MONTHLY'))}
        />
        <Metric
          label={t('stats.contracts.perYear')}
          value={formatEuro(sumContractsForPeriod(contracts, 'YEARLY'))}
        />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 flex flex-col items-center gap-0.5 rounded-md p-3 text-center">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate text-base font-semibold tabular-nums">{value}</span>
    </div>
  )
}
