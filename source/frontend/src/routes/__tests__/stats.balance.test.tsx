import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => {
  const router = await import('./-routerMock')
  return router.routerMocks({
    getRouteApi: () => ({ useSearch: () => router.routeState.search }),
  })
})

import '@/i18n'
import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { UserRead } from '@/lib/auth'
import { Route } from '@/routes/stats_.balance'
import {
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  AMOUNT_L,
  AMOUNT_XL,
  GROUP_NAME_SAVINGS,
  money,
} from '@/test/constants'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import { routeState } from './-routerMock'
import { buildUser, jsonResponse, renderWithQuery } from '@/test/helpers'

const user = buildUser({
  credentials: [
    buildCredential([
      buildAccount({ id: 42, name: ACCOUNT_NAME_GIRO, balance: AMOUNT_L }),
      buildAccount({ id: 43, name: ACCOUNT_NAME_SAVINGS, balance: AMOUNT_XL, balance_factor: 50 }),
      buildAccount({ id: 44, name: 'Depot', balance: AMOUNT_XL }),
    ]),
  ],
})

const NO_GROUPS: AccountGroupLayout = { groups: [], ungrouped: [] }

function serve({ me, layout = NO_GROUPS }: { me?: UserRead; layout?: AccountGroupLayout }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/auth/me') {
      return me ? jsonResponse({ status: 200, body: me }) : jsonResponse({ status: 401 })
    }
    if (url === '/api/account_groups/layout') return jsonResponse({ status: 200, body: layout })
    return jsonResponse({ status: 404 })
  })
}

function renderPage() {
  const Page = Route.options.component!
  return renderWithQuery(<Page />)
}

beforeEach(() => {
  routeState.search = { account_ids: [42, 43] }
})

describe('AccountBalancesPage', () => {
  it('lists the selected accounts with their balance and a factored total', async () => {
    serve({ me: user })
    renderPage()

    const giro = await screen.findByRole('link', { name: new RegExp(ACCOUNT_NAME_GIRO) })
    expect(giro).toHaveAttribute('href', '/account/42')
    expect(giro).toHaveTextContent(money(AMOUNT_L))
    const savings = screen.getByRole('link', { name: new RegExp(ACCOUNT_NAME_SAVINGS) })
    expect(savings).toHaveTextContent(`x 0,50${money(AMOUNT_XL)}`)
    expect(screen.queryByText('Depot')).toBeNull()

    expect(screen.getByText('Total').nextElementSibling).toHaveTextContent(
      money(AMOUNT_L + AMOUNT_XL / 2),
    )
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/stats')
  })

  it('groups the accounts under the user’s own group headings', async () => {
    serve({
      me: user,
      layout: {
        groups: [{ id: 1, name: GROUP_NAME_SAVINGS, accounts: [{ id: 43 }] }],
        ungrouped: [{ id: 42 }],
      },
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: GROUP_NAME_SAVINGS })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Without group' })).toBeInTheDocument()
  })

  it('says so when no account is selected', async () => {
    routeState.search = {}
    serve({ me: user })
    renderPage()

    expect(await screen.findByText('No accounts selected.')).toBeInTheDocument()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('renders nothing while the user is unknown', async () => {
    serve({})
    const { container } = renderPage()

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('parses the account selection from the URL', () => {
    const validate = Route.options.validateSearch as (search: object) => unknown

    expect(validate({ account_ids: '42' })).toEqual({ account_ids: [42] })
    expect(validate({})).toEqual({})
    expect(() => validate({ account_ids: 'all' })).toThrow()
  })
})
