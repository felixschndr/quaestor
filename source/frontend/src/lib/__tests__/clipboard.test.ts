import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '../clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  // Reset any clipboard we patched onto navigator between tests.
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('copyText', () => {
  it('uses the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await copyText('DE12345678900001')

    expect(writeText).toHaveBeenCalledWith('DE12345678900001')
  })

  it('falls back to execCommand in non-secure contexts where clipboard is missing', async () => {
    // navigator.clipboard is undefined (reset in afterEach), as on http://<lan-ip>.
    const execCommand = vi.fn().mockReturnValue(true)
    // jsdom does not implement execCommand; define it for the fallback path.
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })

    await copyText('DE12345678900001')

    expect(execCommand).toHaveBeenCalledWith('copy')
    // The temporary textarea must be cleaned up.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('rejects when the execCommand fallback reports failure', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    })

    await expect(copyText('DE12345678900001')).rejects.toThrow()
    expect(document.querySelector('textarea')).toBeNull()
  })
})
