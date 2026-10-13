import { queryOptions, useQuery } from '@tanstack/react-query'

import { api } from './api'
import { useInvalidatingMutation } from './mutation'

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

export const apiKeysQuery = () =>
  queryOptions({
    queryKey: apiKeyQueryKeys.list,
    queryFn: () => api<ApiKeyRead[]>('/api_keys'),
  })

export function useApiKeys() {
  return useQuery(apiKeysQuery())
}

export function useCreateApiKey() {
  return useInvalidatingMutation({
    mutationFn: (name: string) =>
      api<ApiKeyCreated>('/api_keys', { method: 'POST', body: { name } }),
    invalidate: [apiKeyQueryKeys.list],
  })
}

export function useDeleteApiKey() {
  return useInvalidatingMutation({
    mutationFn: (apiKeyId: number) => api<void>(`/api_keys/${apiKeyId}`, { method: 'DELETE' }),
    invalidate: [apiKeyQueryKeys.list],
  })
}
