import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'

import '@/i18n'

import { PullToRefresh } from '@/components/pull-to-refresh'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setScrollY(0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true })
}

function fireTouch(type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: clientY < 0 ? [] : [{ clientY }],
    configurable: true,
  })
  act(() => {
    window.dispatchEvent(event)
  })
}

function pull(from: number, to: number) {
  fireTouch('touchstart', from)
  fireTouch('touchmove', to)
}

function renderComponent(onRefresh: () => Promise<unknown>) {
  return render(
    <PullToRefresh onRefresh={onRefresh}>
      <div>content</div>
    </PullToRefresh>,
  )
}

describe('PullToRefresh', () => {
  it('triggers a refresh when pulled past the threshold and released', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderComponent(onRefresh)

    pull(10, 410) // delta 400 * 0.5 = 200px, capped to MAX_PULL, past the threshold
    fireTouch('touchend', 410)

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('shows the refreshing label until the refresh resolves', async () => {
    let resolve: () => void = () => {}
    const onRefresh = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    renderComponent(onRefresh)

    pull(10, 410)
    fireTouch('touchend', 410)

    await waitFor(() => expect(screen.getByText('Refreshing …')).toBeInTheDocument())
    act(() => resolve())
    await waitFor(() => expect(screen.queryByText('Refreshing …')).not.toBeInTheDocument())
  })

  it('always shows the built-in "server only, no bank query" hint', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderComponent(onRefresh)

    expect(screen.getByText(/no bank query/i)).toBeInTheDocument()
  })

  it('does not refresh when the pull stays below the threshold', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderComponent(onRefresh)

    pull(10, 50) // delta 40 * 0.5 = 20px, below threshold
    fireTouch('touchend', 50)

    await Promise.resolve()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('ignores the gesture when the page is not scrolled to the top', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    setScrollY(120)
    renderComponent(onRefresh)

    pull(10, 220)
    fireTouch('touchend', 220)

    await Promise.resolve()
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
