import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks({ useNavigate: () => navigate }),
)

import { PARTY_SUPERMARKET, SEARCH_HREF_SUPERMARKET } from '@/test/constants'
import { HrefLink } from '../href-link'

beforeEach(() => navigate.mockClear())

describe('HrefLink', () => {
  it('is a real link and navigates client-side on a plain click', () => {
    const onClick = vi.fn()
    render(
      <HrefLink href={SEARCH_HREF_SUPERMARKET} onClick={onClick}>
        {PARTY_SUPERMARKET}
      </HrefLink>,
    )

    const link = screen.getByRole('link', { name: PARTY_SUPERMARKET })
    expect(link).toHaveAttribute('href', SEARCH_HREF_SUPERMARKET)
    fireEvent.click(link)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ href: SEARCH_HREF_SUPERMARKET })
  })

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])('leaves %o to the browser (new tab/window)', (init) => {
    render(<HrefLink href={SEARCH_HREF_SUPERMARKET}>{PARTY_SUPERMARKET}</HrefLink>)

    fireEvent.click(screen.getByRole('link'), init)

    expect(navigate).not.toHaveBeenCalled()
  })

  it('lets its own click handler cancel the navigation', () => {
    render(
      <HrefLink href={SEARCH_HREF_SUPERMARKET} onClick={(event) => event.preventDefault()}>
        {PARTY_SUPERMARKET}
      </HrefLink>,
    )

    fireEvent.click(screen.getByRole('link'))

    expect(navigate).not.toHaveBeenCalled()
  })
})
