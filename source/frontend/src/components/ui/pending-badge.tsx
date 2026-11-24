import { useTranslation } from 'react-i18next'

export function PendingBadge({ pending }: { pending: boolean | undefined }) {
  const { t } = useTranslation()
  if (!pending) return null
  return (
    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
      {t('transaction.pendingBadge')}
    </span>
  )
}
