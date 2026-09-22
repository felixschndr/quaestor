import { describe, expect, it } from 'vitest'

import { CATEGORY_GROUPS, TRANSACTION_CATEGORIES } from '@/lib/transaction'
import { CATEGORY_ICONS, GROUP_TONES } from '@/lib/categoryIcons'
import de from '@/i18n/locales/de.json'
import en from '@/i18n/locales/en.json'

function expectLabels(key: string) {
  expect(
    de.common.transactionLabel[key as keyof typeof de.common.transactionLabel],
    `missing de label for ${key}`,
  ).toBeTruthy()
  expect(
    en.common.transactionLabel[key as keyof typeof en.common.transactionLabel],
    `missing en label for ${key}`,
  ).toBeTruthy()
}

describe('category presentation covers the generated lists', () => {
  it.each(TRANSACTION_CATEGORIES)('%s has an icon and de/en labels', (category) => {
    expect(CATEGORY_ICONS[category], `missing icon for ${category}`).toBeDefined()
    expectLabels(category)
  })

  it.each(CATEGORY_GROUPS)('group %s has an icon, a tone and de/en labels', (group) => {
    expect(CATEGORY_ICONS[group], `missing icon for ${group}`).toBeDefined()
    expect(GROUP_TONES[group], `missing tone for ${group}`).toBeDefined()
    expectLabels(group)
  })
})
