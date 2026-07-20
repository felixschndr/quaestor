import { describe, expect, it } from 'vitest'

import { TRANSACTION_CATEGORIES } from '@/lib/transaction'
import { CATEGORY_ICONS } from '@/lib/categoryIcons'
import de from '@/i18n/locales/de.json'
import en from '@/i18n/locales/en.json'

describe('category presentation covers the generated list', () => {
  it.each(TRANSACTION_CATEGORIES)('%s has an icon and de/en labels', (category) => {
    expect(CATEGORY_ICONS[category], `missing icon for ${category}`).toBeDefined()
    expect(de.category[category as keyof typeof de.category], `missing de label`).toBeTruthy()
    expect(en.category[category as keyof typeof en.category], `missing en label`).toBeTruthy()
  })
})
