import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from './api'

export interface NotificationLogEntry {
  id: number
  title: string
  body: string
  url: string | null
  created_at: string
  read_at: string | null
}

export const LOG_RETENTION_DAYS = 14

export const notificationLogQueryKeys = {
  all: ['notification_log'] as const,
}

export function useNotificationLog() {
  return useQuery({
    queryKey: notificationLogQueryKeys.all,
    queryFn: () => api<NotificationLogEntry[]>('/notification_log'),
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entryId: number) =>
      api<NotificationLogEntry>(`/notification_log/${entryId}/read`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationLogQueryKeys.all })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/notification_log/read', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationLogQueryKeys.all })
    },
  })
}

const CLICKED_HASH = /^#n=(\d+)$/

export async function consumeClickedNotification(queryClient: QueryClient): Promise<number | null> {
  const match = window.location.hash.match(CLICKED_HASH)
  if (!match) return null
  const entryId = Number(match[1])
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  try {
    await api(`/notification_log/${entryId}/read`, { method: 'POST' })
    await queryClient.invalidateQueries({ queryKey: notificationLogQueryKeys.all })
  } catch {
    // A stale id (entry already pruned) is not worth bothering the user about.
  }
  return entryId
}

export function unreadCount(entries: NotificationLogEntry[] | undefined): number {
  return (entries ?? []).filter((entry) => entry.read_at === null).length
}
