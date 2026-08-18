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

  it('rejects when the clipboard API is unavailable (non-secure context)', async () => {
    await expect(copyText(TEST_IBAN)).rejects.toThrow()
  })
})
