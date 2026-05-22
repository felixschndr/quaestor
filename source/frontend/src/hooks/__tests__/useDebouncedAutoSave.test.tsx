import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'

// A 10 ms debounce is short enough that real timers keep the suite fast while
// still meaningfully exercising the debounce behavior.
const DELAY = 10

describe('useDebouncedAutoSave', () => {
  it('stays idle when local value equals the remote value', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useDebouncedAutoSave({ value: 'hi', remoteValue: 'hi', onSave, delayMs: DELAY }),
    )
    expect(result.current).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('debounces save and reports the lifecycle', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedAutoSave({ value, remoteValue: '', onSave, delayMs: DELAY }),
      { initialProps: { value: '' } },
    )

    rerender({ value: 'h' })
    expect(result.current).toBe('pending')
    rerender({ value: 'hi' })
    expect(result.current).toBe('pending')

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('hi')
    await waitFor(() => expect(result.current).toBe('saved'))
  })

  it('only fires once for the final value when the user keeps typing within the window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ value }) => useDebouncedAutoSave({ value, remoteValue: '', onSave, delayMs: DELAY }),
      { initialProps: { value: '' } },
    )

    // Three rerenders within the same tick — earlier scheduled saves must be
    // cancelled by the cleanup function in the effect.
    rerender({ value: 'a' })
    rerender({ value: 'ab' })
    rerender({ value: 'abc' })

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('abc')
  })

  it('reports "error" when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('boom'))
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedAutoSave({ value, remoteValue: '', onSave, delayMs: DELAY }),
      { initialProps: { value: '' } },
    )
    rerender({ value: 'x' })
    await waitFor(() => expect(result.current).toBe('error'))
  })
})
