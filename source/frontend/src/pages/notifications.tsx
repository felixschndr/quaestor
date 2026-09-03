import { useTranslation } from 'react-i18next'
import { CheckCheck } from 'lucide-react'

import { BackLink } from '@/components/back-link'
import { Button } from '@/components/ui/button'
import { formatRelativeDateTime } from '@/lib/format'
import type { NotificationLogEntry } from '@/lib/notificationLog'
import type { NotificationLogViewProps } from '@/routes/notifications'
import { cn } from '@/lib/utils'

export function NotificationLogView({
  entries,
  onOpen,
  onMarkAllRead,
  retentionDays,
}: NotificationLogViewProps) {
  const { t } = useTranslation()
  const hasUnread = entries.some((entry) => entry.read_at === null)

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-foreground flex-1 text-lg font-semibold">
          {t('notificationLog.title')}
        </h1>
        {hasUnread ? (
          <Button type="button" variant="primary" size="sm" onClick={onMarkAllRead}>
            <CheckCheck className="size-3.5" aria-hidden="true" />
            {t('notificationLog.markAllRead')}
          </Button>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('notificationLog.empty')}</p>
      ) : (
        <>
          <ul className="border-border bg-card flex flex-col rounded-lg border">
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onOpen={onOpen} />
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            {t('notificationLog.retention', { days: retentionDays })}
          </p>
        </>
      )}
    </main>
  )
}

function EntryRow({
  entry,
  onOpen,
}: {
  entry: NotificationLogEntry
  onOpen: (entry: NotificationLogEntry) => void
}) {
  const { t } = useTranslation()
  const isUnread = entry.read_at === null

  return (
    <li className="border-border/40 border-t first:border-t-0">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="hover:bg-muted/60 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors"
      >
        <span
          className={cn('size-2 shrink-0 rounded-full', isUnread ? 'bg-primary' : 'bg-transparent')}
          aria-hidden="true"
        />
        <span className="flex flex-1 flex-col gap-0.5">
          <span className={cn('text-sm', isUnread ? 'font-semibold' : 'font-medium')}>
            {entry.title}
          </span>
          <span className="text-muted-foreground text-xs whitespace-pre-line">{entry.body}</span>
          <span className="text-muted-foreground text-xs">
            {formatRelativeDateTime(entry.created_at, t)}
            {isUnread ? ` · ${t('notificationLog.unread')}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
}
