import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Switch } from '@/components/ui/switch'
import { isOfflineCacheEnabled, setOfflineCacheEnabled } from '@/lib/offlineCache'

export function OfflineCacheToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <label className="border-border bg-card flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
      <span className="flex flex-col">
        <span className="text-sm font-medium">{t('offlineCache.title')}</span>
        <span className="text-muted-foreground text-xs">{t('offlineCache.description')}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={t('offlineCache.title')}
      />
    </label>
  )
}

/** The toggle for a logged-in user: takes effect right away. */
export function OfflineCacheSetting() {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(isOfflineCacheEnabled)
  const change = (next: boolean) => {
    setEnabled(next)
    void setOfflineCacheEnabled(queryClient, next)
  }
  return <OfflineCacheToggle checked={enabled} onCheckedChange={change} />
}
