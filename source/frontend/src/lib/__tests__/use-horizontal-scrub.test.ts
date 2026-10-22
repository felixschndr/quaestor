import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useHorizontalScrubLock } from '@/lib/use-horizontal-scrub'

type Point = { clientX: number; clientY: number }

function touch(
  node: HTMLElement,
  type: 'touchstart' | 'touchmove',
  point?: Point,
  cancelable = true,
) {
  const event = new Event(type, { cancelable })
  Object.defineProperty(event, 'touches', { value: point ? [point] : [] })
  node.dispatchEvent(event)
  return event
}

function attach() {
  const node = document.createElement('div')
  const { result } = renderHook(() => useHorizontalScrubLock<HTMLDivElement>())
  result.current(node)
  return { node, ref: result.current }
}

describe('useHorizontalScrubLock', () => {
  it('keeps the page from scrolling once a gesture turns out horizontal', () => {
    const { node } = attach()

    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    expect(touch(node, 'touchmove', { clientX: 103, clientY: 100 }).defaultPrevented).toBe(false)
    expect(touch(node, 'touchmove', { clientX: 120, clientY: 102 }).defaultPrevented).toBe(true)
    expect(touch(node, 'touchmove', { clientX: 121, clientY: 160 }).defaultPrevented).toBe(true)
  })

  it('lets a vertical gesture scroll the page and decides afresh on the next touch', () => {
    const { node } = attach()

    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    expect(touch(node, 'touchmove', { clientX: 102, clientY: 130 }).defaultPrevented).toBe(false)
    expect(touch(node, 'touchmove', { clientX: 140, clientY: 130 }).defaultPrevented).toBe(false)

    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    expect(touch(node, 'touchmove', { clientX: 130, clientY: 101 }).defaultPrevented).toBe(true)
  })

  it('ignores touch events without a touch point', () => {
    const { node } = attach()

    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    touch(node, 'touchstart')
    expect(touch(node, 'touchmove').defaultPrevented).toBe(false)
    expect(touch(node, 'touchmove', { clientX: 130, clientY: 100 }).defaultPrevented).toBe(true)
  })

  it('does not try to cancel a move the browser marked as non-cancelable', () => {
    const { node } = attach()
    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    const event = new Event('touchmove', { cancelable: false })
    Object.defineProperty(event, 'touches', { value: [{ clientX: 140, clientY: 100 }] })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    node.dispatchEvent(event)

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('stops guarding a node once the ref is detached', () => {
    const { node, ref } = attach()

    ref(null)

    touch(node, 'touchstart', { clientX: 100, clientY: 100 })
    expect(touch(node, 'touchmove', { clientX: 140, clientY: 100 }).defaultPrevented).toBe(false)
  })
})
