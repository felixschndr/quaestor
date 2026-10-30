import { QueryClient } from '@tanstack/react-query'
import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
import { authQueryKeys, type AccountRead } from '@/lib/auth'
import {
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_SAVINGS,
  LABEL_SALARY,
  LABEL_SAVINGS,
  TEST_IBAN,
  TEST_IBAN_FORMATTED,
} from '@/test/constants'
import { renderHookWithClient } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'

function account(overrides: Partial<AccountRead> & Pick<AccountRead, 'id'>): AccountRead {
  return buildAccount({ name: TEST_IBAN, ...overrides })
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
  it.each([
    ['returns the display_name when present', ACCOUNT_NAME_CHECKING, ACCOUNT_NAME_CHECKING],
    ['falls back to the formatted IBAN when display_name is null', null, TEST_IBAN_FORMATTED],
    ['treats a whitespace-only display_name as unset', '   ', TEST_IBAN_FORMATTED],
    ['trims the display_name before returning it', `  ${LABEL_SAVINGS}  `, LABEL_SAVINGS],
  ])('%s', (_, displayName, expected) => {
    expect(accountDisplayName({ name: TEST_IBAN, display_name: displayName })).toBe(expected)
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
        buildCredential([account({ id: 1 }), account({ id: 2, include_by_default: false })]),
        buildCredential([account({ id: 3 })], { id: 2 }),
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
      buildCredential([account({ id: 1, display_name: ACCOUNT_NAME_CHECKING })]),
      buildCredential([account({ id: 2, name: ACCOUNT_NAME_SAVINGS })], { id: 2 }),
    ])
    expect([...names]).toEqual([
      [1, ACCOUNT_NAME_CHECKING],
      [2, ACCOUNT_NAME_SAVINGS],
    ])
  })
})

describe('account mutations', () => {
  function renderWithClient<T>(hook: () => T) {
    const client = new QueryClient()
    client.setQueryData(authQueryKeys.me, { id: 1 })
    return renderHookWithClient(hook, client)
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
