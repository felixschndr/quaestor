import { createFileRoute, useRouter } from '@tanstack/react-router'

import {
  LOG_RETENTION_DAYS,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationLog,
  type NotificationLogEntry,
} from '@/lib/notificationLog'
import { NotificationLogView } from '@/pages/notifications'

export const Route = createFileRoute('/notifications')({
  component: NotificationLogPage,
})

function NotificationLogPage() {
  const { data: entries } = useNotificationLog()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const router = useRouter()

  const onOpen = (entry: NotificationLogEntry) => {
    if (entry.read_at === null) markRead.mutate(entry.id)
    if (entry.url) router.history.push(entry.url)
  }

  return (
    <NotificationLogView
      entries={entries ?? []}
      onOpen={onOpen}
      onMarkAllRead={() => markAllRead.mutate()}
      retentionDays={LOG_RETENTION_DAYS}
    />
  )
}

export interface NotificationLogViewProps {
  entries: NotificationLogEntry[]
  onOpen: (entry: NotificationLogEntry) => void
  onMarkAllRead: () => void
  retentionDays: number
}
