import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type { ContractRead } from '@/lib/contract'

type BadgeSize = 'sm' | 'md'

function badgeClass(size: BadgeSize): string {
  return cn(
    'shrink-0 rounded-full px-2 py-0.5 font-semibold',
    size === 'md' ? 'text-xs' : 'text-[10px]',
  )
}

export function ArchivedBadge({ size = 'sm' }: { size?: BadgeSize }) {
  const { t } = useTranslation()
  return (
    <span className={cn(badgeClass(size), 'bg-muted text-muted-foreground')}>
      {t('common.archived')}
    </span>
  )
}

export function ContractStatusBadge({
  contract,
  size = 'sm',
}: {
  contract: ContractRead
  size?: BadgeSize
}) {
  const { t } = useTranslation()
  const base = badgeClass(size)
  if (contract.is_archived) {
    return <ArchivedBadge size={size} />
  }
  if (contract.is_overdue) {
    return <span className={cn(base, 'bg-warning/10 text-warning')}>{t('common.overdue')}</span>
  }
  return null
}
