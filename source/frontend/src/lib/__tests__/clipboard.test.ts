import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { toast } from 'sonner'

import { COPY_FEEDBACK_MS, copyText, useCopyFeedback } from '../clipboard'
import { TEST_IBAN } from '@/test/constants'

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('copyText', () => {
  it('falls back to execCommand in a non-secure context', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    await copyText(TEST_IBAN)

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('rejects when the fallback is rejected too', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    })

    await expect(copyText(TEST_IBAN)).rejects.toThrow()
    expect(document.querySelector('textarea')).toBeNull()
  })
})

describe('useCopyFeedback', () => {
  function allowClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('confirms a copy for two seconds, restarting the timer on every copy', async () => {
    vi.useFakeTimers()
    const writeText = allowClipboard()
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => expect(await result.current.copy(TEST_IBAN)).toBe(true))
    expect(writeText).toHaveBeenCalledWith(TEST_IBAN)
    expect(result.current.copied).toBe(true)

    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1))
    await act(() => result.current.copy(TEST_IBAN))
    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1))
    expect(result.current.copied).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.copied).toBe(false)
  })

  it('explains why copying failed', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    })
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => expect(await result.current.copy(TEST_IBAN)).toBe(false))

    expect(result.current.copied).toBe(false)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      'Copying failed – Quaestor needs to be served over HTTPS or localhost.',
    )
  })

  it('cancels the pending reset when unmounted', async () => {
    vi.useFakeTimers()
    allowClipboard()
    const { result, unmount } = renderHook(() => useCopyFeedback())
    await act(() => result.current.copy(TEST_IBAN))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
