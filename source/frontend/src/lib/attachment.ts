import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

export interface AttachmentRead {
  id: number
  filename: string
  content_type: string | null
  size: number
  created_at: string
}

const base = (accountId: number, transactionId: number) =>
  `/account/${accountId}/transactions/${transactionId}/attachments`

export const attachmentQueryKeys = {
  list: (accountId: number, transactionId: number) =>
    ['account', accountId, 'transaction', transactionId, 'attachments'] as const,
}

export function attachmentDownloadUrl(
  accountId: number,
  transactionId: number,
  attachmentId: number,
): string {
  return `/api${base(accountId, transactionId)}/${attachmentId}`
}

export function useAttachments(accountId: number, transactionId: number) {
  return useQuery({
    queryKey: attachmentQueryKeys.list(accountId, transactionId),
    queryFn: () => api<AttachmentRead[]>(base(accountId, transactionId)),
  })
}

export function useUploadAttachments(accountId: number, transactionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData()
      for (const file of files) form.append('files', file)
      return api<AttachmentRead[]>(base(accountId, transactionId), { method: 'POST', body: form })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentQueryKeys.list(accountId, transactionId),
      })
    },
  })
}

export function useDeleteAttachment(accountId: number, transactionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (attachmentId: number) =>
      api<void>(`${base(accountId, transactionId)}/${attachmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentQueryKeys.list(accountId, transactionId),
      })
    },
  })
}
