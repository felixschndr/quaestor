import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import i18n, { useApplyUserLanguage } from '@/i18n'

describe('useApplyUserLanguage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('applies a supported user language to i18next', async () => {
    await i18n.changeLanguage('en')
    renderHook(() => useApplyUserLanguage('de'))
    await waitFor(() => expect(i18n.language).toBe('de'))
  })

  it('is a no-op while the language is still loading (undefined)', async () => {
    await i18n.changeLanguage('de')
    renderHook(() => useApplyUserLanguage(undefined))
    // No change scheduled — the detector's choice stands.
    expect(i18n.language).toBe('de')
  })

  it('ignores unsupported languages', async () => {
    await i18n.changeLanguage('en')
    renderHook(() => useApplyUserLanguage('fr'))
    expect(i18n.language).toBe('en')
  })

  it('reacts when the user language changes after mount', async () => {
    await i18n.changeLanguage('en')
    const { rerender } = renderHook(({ lang }) => useApplyUserLanguage(lang), {
      initialProps: { lang: 'en' as string | undefined },
    })
    expect(i18n.language).toBe('en')
    rerender({ lang: 'de' })
    await waitFor(() => expect(i18n.language).toBe('de'))
  })
})
