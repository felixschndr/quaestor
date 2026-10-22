import { renderHook } from '@testing-library/react'
import { de, enUS } from 'date-fns/locale'
import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { formatMoney, wrapWithCurrency } from '@/lib/format'
import { AMOUNT_M, AMOUNT_XL } from '@/test/constants'
import { euroAxisFormat, euroFormat, useDateFnsLocale, useMonthLabel } from '../chartTheme'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('euroAxisFormat', () => {
  it('abbreviates thousands and millions', () => {
    expect(euroAxisFormat(2_500_000)).toBe(wrapWithCurrency('2,5M'))
    expect(euroAxisFormat(-AMOUNT_XL)).toBe(wrapWithCurrency('-1,5k'))
    expect(euroAxisFormat(AMOUNT_M)).toBe(wrapWithCurrency(String(AMOUNT_M)))
  })

  it('leaves non-numeric ticks blank', () => {
    expect(euroAxisFormat('n/a')).toBe('')
  })
})

describe('euroFormat', () => {
  it('formats numeric strings recharts hands over as money', () => {
    expect(euroFormat(String(AMOUNT_M))).toBe(formatMoney(AMOUNT_M))
  })
})

describe('useDateFnsLocale', () => {
  it('follows the UI language', async () => {
    const { result, rerender } = renderHook(() => useDateFnsLocale())
    expect(result.current).toBe(enUS)

    await i18n.changeLanguage('de')
    rerender()

    expect(result.current).toBe(de)
  })
})

describe('useMonthLabel', () => {
  it('turns a YYYY-MM bucket into a short month label', () => {
    const { result } = renderHook(() => useMonthLabel())
    expect(result.current('2026-05')).toBe('May 2026')
  })

  it('keeps a bucket it cannot parse as is', () => {
    const { result } = renderHook(() => useMonthLabel())
    expect(result.current('later')).toBe('later')
  })
})
