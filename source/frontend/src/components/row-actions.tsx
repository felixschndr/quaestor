import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function RowActions({
  onDelete,
  deleting = false,
  onEdit,
  confirmLabel,
  renderTrigger,
  size = 'sm',
  className,
}: {
  onDelete: () => Promise<unknown>
  deleting?: boolean
  onEdit?: () => void
  confirmLabel?: string
  renderTrigger?: (confirm: () => void) => React.ReactNode
  size?: 'sm' | 'default'
  className?: string
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className={cn('flex gap-1', className)}>
        <Button
          type="button"
          size={size}
          variant="destructive"
          onClick={() => void onDelete().finally(() => setConfirming(false))}
          disabled={deleting}
        >
          {confirmLabel ?? t('common.deleteConfirm')}
        </Button>
        <Button
          type="button"
          size={size}
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={deleting}
        >
          {t('common.cancel')}
        </Button>
      </div>
    )
  }

  if (renderTrigger) return <>{renderTrigger(() => setConfirming(true))}</>

  return (
    <div className={cn('flex gap-1', className)}>
      {onEdit ? (
        <Button
          type="button"
          size={size}
          variant="ghost"
          onClick={onEdit}
          aria-label={t('common.edit')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        type="button"
        size={size}
        variant="ghost"
        onClick={() => setConfirming(true)}
        aria-label={t('common.delete')}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}
