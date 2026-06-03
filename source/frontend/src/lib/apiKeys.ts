import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'

export interface ApiKeyRead {
  id: number
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
}

export interface ApiKeyCreated extends ApiKeyRead {
  token: string
}

export const apiKeyQueryKeys = {
  list: ['api-keys'] as const,
}

export function useApiKeys() {
  return useQuery({
    queryKey: apiKeyQueryKeys.list,
    queryFn: () => api<ApiKeyRead[]>('/api_keys'),
  })
}

export function useCreateApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api<ApiKeyCreated>('/api_keys', { method: 'POST', body: { name } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyQueryKeys.list })
    },
  })
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (apiKeyId: number) => api<void>(`/api_keys/${apiKeyId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyQueryKeys.list })
    },
  })
}
