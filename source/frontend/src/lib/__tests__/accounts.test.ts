import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  accountDisplayName,
  accountNamesById,
  accountSecondaryName,
  defaultAccountIds,
  displayNameOrUserName,
  sameAccountSelection,
  useCreateManualAccount,
  useDeleteAccount,
} from '@/lib/accounts'
import { authQueryKeys, type AccountRead, type CredentialRead } from '@/lib/auth'
import {
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_XL,
  LABEL_SALARY,
  LABEL_SAVINGS,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
} from '@/test/constants'

function buildAccount(overrides: Partial<AccountRead> = {}): AccountRead {
  return {
    id: 1,
    name: TEST_IBAN,
    display_name: null,
    balance: AMOUNT_XL,
    balance_factor: 100,
    is_hidden: false,
    include_by_default: true,
    is_market_valued: false,
    ...overrides,
  }
}

function buildCredential(id: number, accounts: AccountRead[]): CredentialRead {
  return {
    id,
    bank: 'manual',
    bank_name: null,
    bank_icon: null,
    accounts,
    last_successful_sync_timestamp: null,
    requires_two_factor_authentication: false,
    sync_enabled: true,
  }
}

describe('displayNameOrUserName', () => {
  it('uses display_name when present', () => {
    expect(displayNameOrUserName({ display_name: 'Alice', user_name: 'alice' })).toBe('Alice')
  })

  it('falls back to user_name when display_name is empty or whitespace', () => {
    expect(displayNameOrUserName({ display_name: '', user_name: 'alice' })).toBe('alice')
    expect(displayNameOrUserName({ display_name: '   ', user_name: 'alice' })).toBe('alice')
  })
})

describe('accountDisplayName', () => {
  it('returns the display_name when present', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: ACCOUNT_NAME_CHECKING })).toBe(
      ACCOUNT_NAME_CHECKING,
    )
  })

  it('falls back to the formatted IBAN when display_name is null', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: null })).toBe(TEST_IBAN_FORMATTED)
  })

  it('treats a whitespace-only display_name as unset', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: '   ' })).toBe(TEST_IBAN_FORMATTED)
  })

  it('trims the display_name before returning it', () => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: `  ${LABEL_SAVINGS}  ` })).toBe(
      LABEL_SAVINGS,
    )
  })
})

describe('accountSecondaryName', () => {
  it('returns null when no personalised name is set (the IBAN is already the primary label)', () => {
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: null })).toBeNull()
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: '  ' })).toBeNull()
  })

  it('returns the formatted IBAN when a personalised name is set', () => {
    expect(accountSecondaryName({ name: TEST_IBAN, display_name: LABEL_SALARY })).toBe(
      TEST_IBAN_FORMATTED,
    )
  })
})

describe('defaultAccountIds', () => {
  it('collects the accounts included by default across all connections', () => {
    expect(
      defaultAccountIds([
        buildCredential(1, [
          buildAccount({ id: 1 }),
          buildAccount({ id: 2, include_by_default: false }),
        ]),
        buildCredential(2, [buildAccount({ id: 3 })]),
      ]),
    ).toEqual([1, 3])
  })
})

describe('sameAccountSelection', () => {
  it('compares selections regardless of order', () => {
    expect(sameAccountSelection([1, 2], [2, 1])).toBe(true)
  })

  it('tells selections of different size or members apart', () => {
    expect(sameAccountSelection([1, 2], [1])).toBe(false)
    expect(sameAccountSelection([1, 2], [1, 3])).toBe(false)
  })
})

describe('accountNamesById', () => {
  it('maps every account to its display name', () => {
    const names = accountNamesById([
      buildCredential(1, [buildAccount({ id: 1, display_name: ACCOUNT_NAME_CHECKING })]),
      buildCredential(2, [buildAccount({ id: 2, name: ACCOUNT_NAME_SAVINGS })]),
    ])
    expect([...names]).toEqual([
      [1, ACCOUNT_NAME_CHECKING],
      [2, ACCOUNT_NAME_SAVINGS],
    ])
  })
})

describe('account mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithClient<T>(hook: () => T) {
    const client = new QueryClient()
    client.setQueryData(authQueryKeys.me, { id: 1 })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    return { client, ...renderHook(hook, { wrapper }) }
  }

  it('creates a manual account via POST and reloads the user', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { client, result } = renderWithClient(() => useCreateManualAccount())

    await act(async () => {
      await result.current.mutateAsync({ credential_id: 1, name: ACCOUNT_NAME_SAVINGS })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/account')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ credential_id: 1, name: ACCOUNT_NAME_SAVINGS })
    expect(client.getQueryState(authQueryKeys.me)?.isInvalidated).toBe(true)
  })

  it('deletes an account via DELETE and reloads the user', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { client, result } = renderWithClient(() => useDeleteAccount())

    await act(async () => {
      await result.current.mutateAsync(5)
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/account/5')
    expect(init.method).toBe('DELETE')
    expect(client.getQueryState(authQueryKeys.me)?.isInvalidated).toBe(true)
  })
})
