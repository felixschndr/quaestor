import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const formatSetters = vi.hoisted(() => ({
  setDisplayTimeZone: vi.fn(),
  setDisplayCurrency: vi.fn(),
}))
vi.mock('@/lib/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format')>()),
  ...formatSetters,
}))

import {
  ensureAppSettings,
  settingsQueryKey,
  useAppSettings,
  type AppSettings,
} from '@/lib/settings'
import { jsonResponse } from '@/routes/__tests__/-settingsUserTestHelpers'

const SETTINGS: AppSettings = {
  allow_new_user_registration: false,
  default_language: 'de',
  default_currency: 'CHF',
  display_timezone: 'Europe/Berlin',
  sync_interval_hours: 6,
  allowed_attachment_extensions: ['pdf'],
  max_attachment_size_mb: 10,
  trigger_default_days: {},
  default_digest_weekday: 0,
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ status: 200, body: SETTINGS }))
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ensureAppSettings', () => {
  it('loads the settings once and applies the display time zone and currency', async () => {
    const queryClient = newQueryClient()

    await ensureAppSettings(queryClient)
    await ensureAppSettings(queryClient)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings')
    expect(queryClient.getQueryData(settingsQueryKey)).toEqual(SETTINGS)
    expect(formatSetters.setDisplayTimeZone).toHaveBeenCalledWith('Europe/Berlin')
    expect(formatSetters.setDisplayCurrency).toHaveBeenCalledWith('CHF')
  })

  it('keeps the defaults when the settings cannot be loaded', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 500, body: { detail: 'boom' } }))

    await expect(ensureAppSettings(newQueryClient())).resolves.toBeUndefined()

    expect(formatSetters.setDisplayTimeZone).not.toHaveBeenCalled()
    expect(formatSetters.setDisplayCurrency).not.toHaveBeenCalled()
  })
})

describe('useAppSettings', () => {
  it('serves the settings from the cache that ensureAppSettings filled', async () => {
    const queryClient = newQueryClient()
    await ensureAppSettings(queryClient)
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useAppSettings(), { wrapper })

    expect(result.current.data).toEqual(SETTINGS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches the settings when nothing is cached yet', async () => {
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useAppSettings(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(SETTINGS))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings')
  })
})
