import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  CONTRACT_COST_PERIODS,
  contractAmountForPeriod,
  sumContractsForPeriod,
  type ContractCostPeriod,
  type ContractRead,
} from '@/lib/contract'
import { formatDate, formatDateWithoutYear, formatEuro } from '@/lib/format'
import { CategoryAvatar } from '@/lib/categoryIcons'
import { SegmentedToggle } from '@/components/stats/segmented-toggle'
import { cn } from '@/lib/utils'

function formatAmount(value: number | null): string {
  return value === null ? '—' : formatEuro(value)
}

function amountColor(value: number | null): string {
  if (value === null) return ''
  return value < 0 ? 'text-destructive' : 'text-success'
}

function isBillingPeriod(contract: ContractRead, period: ContractCostPeriod): boolean {
  return contract.frequency === period
}

export function ContractCostOverview({ contracts }: { contracts: ContractRead[] }) {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<ContractCostPeriod>('MONTHLY')
  const [mobileView, setMobileView] = useState<'list' | 'table'>('list')

  return (
    <div>
      <div className="hidden lg:block">
        <ContractCostTable contracts={contracts} />
      </div>

      <div className="flex flex-col gap-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <BalanceHeader total={sumContractsForPeriod(contracts, period)} />
          <SegmentedToggle
            ariaLabel={t('contracts.cost.viewLabel')}
            value={mobileView}
            onChange={setMobileView}
            options={[
              { value: 'list', label: t('contracts.cost.viewList') },
              { value: 'table', label: t('contracts.cost.viewTable') },
            ]}
          />
        </div>
        {mobileView === 'list' ? (
          <div className="flex flex-col gap-3">
            <SegmentedToggle
              fullWidth
              ariaLabel={t('common.period')}
              value={period}
              onChange={setPeriod}
              options={CONTRACT_COST_PERIODS.map((option) => ({
                value: option,
                label: t(`contracts.period.${option}`),
              }))}
            />
            <ContractCostList contracts={contracts} period={period} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <ContractCostTable contracts={contracts} />
          </div>
        )}
      </div>
    </div>
  )
}

function BalanceHeader({ total }: { total: number }) {
  const { t } = useTranslation()
  const surplus = total >= 0
  return (
    <div>
      <p className="text-muted-foreground text-xs">
        {surplus ? t('common.surplus') : t('contracts.cost.deficit')}
      </p>
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          surplus ? 'text-success' : 'text-destructive',
        )}
      >
        {formatEuro(total)}
      </p>
    </div>
  )
}

function ContractCostTable({ contracts }: { contracts: ContractRead[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-muted-foreground border-border border-b">
          <th className="w-full min-w-[14rem] py-2 pr-3 text-left text-xs font-medium lg:min-w-0">
            {t('common.name')}
          </th>
          {CONTRACT_COST_PERIODS.map((period) => (
            <th key={period} className="px-3 py-2 text-right text-xs font-medium">
              {t(`contracts.period.${period}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {contracts.map((contract) => (
          <tr
            key={contract.id}
            onClick={() =>
              navigate({
                to: '/contracts/$contractId',
                params: { contractId: String(contract.id) },
              })
            }
            className="border-border hover:bg-muted/60 cursor-pointer border-b transition-colors"
          >
            <td className="w-full max-w-0 min-w-[14rem] py-2.5 pr-3 lg:min-w-0">
              <Link
                to="/contracts/$contractId"
                params={{ contractId: String(contract.id) }}
                onClick={(event) => event.stopPropagation()}
                className="hover:text-primary grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 transition-colors"
              >
                <CategoryAvatar
                  category={contract.category ?? 'UNKNOWN'}
                  className="col-start-1 row-start-2 size-8 self-center lg:row-span-2 lg:row-start-1"
                  iconClassName="size-4"
                />
                <span className="col-span-2 row-start-1 flex min-w-0 items-center gap-2 lg:col-span-1 lg:col-start-2">
                  <span className="truncate font-medium">{contract.name}</span>
                  {contract.is_overdue ? <OverdueBadge label={t('contracts.overdue')} /> : null}
                </span>
                <span className="col-start-2 row-start-2 flex min-w-0 flex-col text-xs text-muted-foreground lg:flex-row lg:gap-1">
                  <span className="truncate">
                    {contract.frequency
                      ? t(`contracts.frequency.${contract.frequency}`)
                      : t('contracts.frequencyUnknown')}
                  </span>
                  {contract.expected_next_date ? (
                    <span className={cn('truncate', contract.is_overdue && 'text-warning')}>
                      <span aria-hidden="true" className="hidden lg:inline">
                        ·{' '}
                      </span>
                      <span className="lg:hidden">
                        {formatDateWithoutYear(contract.expected_next_date)}
                      </span>
                      <span className="hidden lg:inline">
                        {formatDate(contract.expected_next_date)}
                      </span>
                    </span>
                  ) : null}
                </span>
              </Link>
            </td>
            {CONTRACT_COST_PERIODS.map((period) => {
              const value = contractAmountForPeriod(contract, period)
              return (
                <td
                  key={period}
                  className={cn(
                    'px-3 py-2.5 text-right tabular-nums whitespace-nowrap',
                    period === 'MONTHLY' && amountColor(value),
                    isBillingPeriod(contract, period) && 'font-medium',
                  )}
                >
                  {formatAmount(value)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-border border-t-[3px] border-double font-semibold">
          <td className="py-2.5 pr-3">{t('contracts.cost.total')}</td>
          {CONTRACT_COST_PERIODS.map((period) => {
            const total = sumContractsForPeriod(contracts, period)
            return (
              <td
                key={period}
                className={cn(
                  'px-3 py-2.5 text-right tabular-nums whitespace-nowrap',
                  period === 'MONTHLY' && amountColor(total),
                )}
              >
                {formatEuro(total)}
              </td>
            )
          })}
        </tr>
      </tfoot>
    </table>
  )
}

function ContractCostList({
  contracts,
  period,
}: {
  contracts: ContractRead[]
  period: ContractCostPeriod
}) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col">
      {contracts.map((contract) => (
        <li key={contract.id} className="border-border border-t first:border-t-0">
          <Link
            to="/contracts/$contractId"
            params={{ contractId: String(contract.id) }}
            className="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors"
          >
            <CategoryAvatar
              category={contract.category ?? 'UNKNOWN'}
              className="size-8"
              iconClassName="size-4"
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{contract.name}</span>
                {contract.is_overdue ? <OverdueBadge label={t('contracts.overdue')} /> : null}
              </span>
              <span className="text-muted-foreground flex flex-col text-xs">
                <span className="truncate">
                  {t('contracts.turnus')}:{' '}
                  {contract.frequency
                    ? t(`contracts.frequency.${contract.frequency}`)
                    : t('contracts.frequencyUnknown')}
                </span>
                {contract.expected_next_date ? (
                  <span className={cn('truncate', contract.is_overdue && 'text-warning')}>
                    {t('contracts.nextExpected')}:{' '}
                    {formatDateWithoutYear(contract.expected_next_date)}
                  </span>
                ) : null}
              </span>
            </span>
            <span
              className={cn(
                'ml-auto text-sm font-medium tabular-nums whitespace-nowrap',
                amountColor(contractAmountForPeriod(contract, period)),
              )}
            >
              {formatAmount(contractAmountForPeriod(contract, period))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function OverdueBadge({ label }: { label: string }) {
  return (
    <span className="bg-warning/10 text-warning shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
      {label}
    </span>
  )
}
