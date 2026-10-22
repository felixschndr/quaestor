import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { Route } from '@/routes/banking.callback'
import { COPY_FEEDBACK_MS } from '@/lib/clipboard'
import { routeState } from './-routerMock'
import { renderWithQuery } from './-settingsUserTestHelpers'
import { BANKING_CALLBACK_CODE } from '@/test/constants'

const Page = Route.options.component!

afterEach(() => {
  vi.useRealTimers()
})

describe('/banking/callback route', () => {
  it('shows the authorization code and copies it for the waiting dialog', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    routeState.search = { code: BANKING_CALLBACK_CODE }
    renderWithQuery(<Page />)

    expect(screen.getByRole('heading', { name: 'Authorization complete' })).toBeInTheDocument()
    expect(screen.getByText(BANKING_CALLBACK_CODE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy code' }))

    expect(await navigator.clipboard.readText()).toBe(BANKING_CALLBACK_CODE)
    expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS))
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
  })

  it('shows the error the bank reported', () => {
    routeState.search = { error: 'access_denied' }
    renderWithQuery(<Page />)

    expect(screen.getByRole('heading', { name: 'Authorization failed' })).toBeInTheDocument()
    expect(
      screen.getByText('The bank reported an error: access_denied. Please start the sync again.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument()
  })

  it('reports an unknown error when the bank sent neither code nor error', () => {
    routeState.search = {}
    renderWithQuery(<Page />)

    expect(
      screen.getByText('The bank reported an error: unknown. Please start the sync again.'),
    ).toBeInTheDocument()
  })

  it('accepts only string code and error search params', () => {
    const validate = Route.options.validateSearch as (search: unknown) => unknown
    expect(validate({ code: BANKING_CALLBACK_CODE, state: 'xyz' })).toEqual({
      code: BANKING_CALLBACK_CODE,
    })
    expect(() => validate({ error: 42 })).toThrow()
  })
})
