import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePopoverScroll } from '@/lib/use-popover-scroll'

const VIEWPORT = 100
const CONTENT = 300

function attach({ scrollHeight = CONTENT, scrollTop = 50 } = {}) {
  const parent = document.createElement('div')
  const node = document.createElement('ul')
  parent.appendChild(node)
  Object.defineProperty(node, 'scrollHeight', { value: scrollHeight })
  Object.defineProperty(node, 'clientHeight', { value: VIEWPORT })
  Object.defineProperty(node, 'scrollTop', { value: scrollTop, writable: true })
  const { result } = renderHook(() => usePopoverScroll<HTMLUListElement>())
  result.current(node)
  return { node, parent, ref: result.current }
}

function wheel(node: HTMLElement, deltaY: number, deltaMode = 0) {
  const event = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true })
  node.dispatchEvent(event)
  return event
}

describe('usePopoverScroll', () => {
  it('scrolls the list itself by the wheel delta and keeps the page still', () => {
    const { node } = attach()

    expect(wheel(node, 30).defaultPrevented).toBe(true)
    expect(node.scrollTop).toBe(80)
  })

  it('converts line and page deltas into pixels', () => {
    const { node } = attach()

    wheel(node, 2, 1)
    expect(node.scrollTop).toBe(82)

    wheel(node, -0.5, 2)
    expect(node.scrollTop).toBe(32)
  })

  it('swallows the wheel at either end so the page never scroll-chains', () => {
    const top = attach({ scrollTop: 0 })
    expect(wheel(top.node, -30).defaultPrevented).toBe(true)
    expect(top.node.scrollTop).toBe(0)

    const bottom = attach({ scrollTop: CONTENT - VIEWPORT })
    expect(wheel(bottom.node, 30).defaultPrevented).toBe(true)
    expect(bottom.node.scrollTop).toBe(CONTENT - VIEWPORT)
  })

  it('leaves the wheel to the page when the list has nothing to scroll', () => {
    const { node } = attach({ scrollHeight: VIEWPORT, scrollTop: 0 })

    expect(wheel(node, 30).defaultPrevented).toBe(false)
    expect(node.scrollTop).toBe(0)
  })

  it('keeps touch moves inside a scrollable list from reaching the page', () => {
    const scrollable = attach()
    const short = attach({ scrollHeight: VIEWPORT })
    const onScrollableParent = vi.fn()
    const onShortParent = vi.fn()
    scrollable.parent.addEventListener('touchmove', onScrollableParent)
    short.parent.addEventListener('touchmove', onShortParent)

    scrollable.node.dispatchEvent(new Event('touchmove', { bubbles: true }))
    short.node.dispatchEvent(new Event('touchmove', { bubbles: true }))

    expect(onScrollableParent).not.toHaveBeenCalled()
    expect(onShortParent).toHaveBeenCalledTimes(1)
  })

  it('stops handling the list once the ref is detached', () => {
    const { node, ref } = attach()

    ref(null)

    expect(wheel(node, 30).defaultPrevented).toBe(false)
    expect(node.scrollTop).toBe(50)
  })
})
