import { describe, expect, it } from 'vitest'

import { TRANSACTION_CATEGORIES } from '@/lib/transaction'
import { CATEGORY_ICONS, CATEGORY_TONES } from '@/lib/categoryIcons'
import de from '@/i18n/locales/de.json'
import en from '@/i18n/locales/en.json'

describe('category presentation covers the generated list', () => {
  it.each(TRANSACTION_CATEGORIES)('%s has an icon, a tone and de/en labels', (category) => {
    expect(CATEGORY_ICONS[category], `missing icon for ${category}`).toBeDefined()
    expect(CATEGORY_TONES[category], `missing tone for ${category}`).toBeDefined()
    expect(
      de.common.transactionLabel[category as keyof typeof de.common.transactionLabel],
      `missing de label`,
    ).toBeTruthy()
    expect(
      en.common.transactionLabel[category as keyof typeof en.common.transactionLabel],
      `missing en label`,
    ).toBeTruthy()
  })
})
