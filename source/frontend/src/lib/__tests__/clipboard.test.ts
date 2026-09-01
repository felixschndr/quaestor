import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '../clipboard'
import { TEST_IBAN } from '@/test/constants'

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('copyText', () => {
  it('uses the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await copyText(TEST_IBAN)

    expect(writeText).toHaveBeenCalledWith(TEST_IBAN)
  })

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
