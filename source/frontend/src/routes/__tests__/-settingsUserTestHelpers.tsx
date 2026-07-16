import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PasswordRequirements, UserRead } from '@/lib/auth'

// Shared fixtures/helpers for the user-settings sub-page tests. (Not a *.test file, so
// vitest does not collect it as a suite.)

export const PASSWORD_REQUIREMENTS: PasswordRequirements = {
  min_length: 15,
  rules: [
    { name: 'lower', regex: '[a-z]', description: 'a lowercase letter' },
    { name: 'upper', regex: '[A-Z]', description: 'an uppercase letter' },
    { name: 'digit', regex: '\\d', description: 'a digit' },
    { name: 'symbol', regex: '[^A-Za-z0-9]', description: 'a special character' },
  ],
}

export function buildUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: 1,
    user_name: 'alice',
    display_name: 'Alice',
    language: 'en',
    theme: 'SYSTEM',
    two_factor_enabled: false,
    balance: 0,
    credentials: [],
    ...overrides,
  }
}

export function jsonResponse({ status, body }: { status: number; body?: unknown }): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
  })
}

export function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
