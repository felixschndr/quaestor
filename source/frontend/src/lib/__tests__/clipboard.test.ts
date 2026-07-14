import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '../clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('copyText', () => {
  it('uses the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await copyText('DE12345678900001')

    expect(writeText).toHaveBeenCalledWith('DE12345678900001')
  })

  it('rejects when the clipboard API is unavailable (non-secure context)', async () => {
    await expect(copyText('DE12345678900001')).rejects.toThrow()
  })
})
