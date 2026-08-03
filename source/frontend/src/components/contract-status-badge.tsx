import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type { ContractRead } from '@/lib/contract'

export function ContractStatusBadge({
  contract,
  size = 'sm',
}: {
  contract: ContractRead
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const base = cn(
    'shrink-0 rounded-full px-2 py-0.5 font-semibold',
    size === 'md' ? 'text-xs' : 'text-[10px]',
  )
  if (contract.is_archived) {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')}>{t('common.archived')}</span>
    )
  }
  if (contract.is_overdue) {
    return <span className={cn(base, 'bg-warning/10 text-warning')}>{t('common.overdue')}</span>
  }
  return null
}
