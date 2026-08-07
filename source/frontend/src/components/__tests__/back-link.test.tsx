import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

const routerState = vi.hoisted(() => ({ canGoBack: true, back: vi.fn() }))

vi.mock('@tanstack/react-router', async () => ({
  ...(await import('@/routes/__tests__/-routerMock')).routerMocks({
    useCanGoBack: () => routerState.canGoBack,
    useRouter: () => ({ history: { back: routerState.back } }),
  }),
}))

import { BackLink } from '@/components/back-link'

beforeEach(() => {
  routerState.canGoBack = true
  routerState.back.mockClear()
})

describe('BackLink', () => {
  it('pops history instead of pushing the fallback, so context is preserved', async () => {
    render(<BackLink to="/account/$accountId" params={{ accountId: '7' }} />)

    await userEvent.click(screen.getByRole('link', { name: 'Back' }))
    expect(routerState.back).toHaveBeenCalledTimes(1)
  })

  it('navigates to the fallback when there is no history (deep link, reload)', async () => {
    routerState.canGoBack = false
    render(<BackLink to="/account/$accountId" params={{ accountId: '7' }} />)

    const link = screen.getByRole('link', { name: 'Back' })
    expect(link).toHaveAttribute('href', '/account/7')
    await userEvent.click(link)
    expect(routerState.back).not.toHaveBeenCalled()
  })

  it('leaves modified clicks to the browser so "open in new tab" still works', () => {
    render(<BackLink to="/stats" />)

    fireEvent.click(screen.getByRole('link', { name: 'Back' }), { metaKey: true })
    expect(routerState.back).not.toHaveBeenCalled()
  })

  it('uses its children as the accessible name when labelled', () => {
    render(<BackLink to="/contracts">Contracts</BackLink>)
    expect(screen.getByRole('link', { name: 'Contracts' })).toHaveAttribute('href', '/contracts')
  })
})
