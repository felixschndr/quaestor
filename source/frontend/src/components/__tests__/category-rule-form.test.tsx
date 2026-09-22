import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/routes/__tests__/-routerMock')).routerMocks(),
)

import { CategoryRuleForm } from '@/components/category-rule-form'
import { renderWithQuery } from '@/routes/__tests__/-settingsUserTestHelpers'

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  await i18n.changeLanguage('en')
})

describe('CategoryRuleForm', () => {
  it('follows the picked category in its hint', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <CategoryRuleForm
        initialCategory="SUPERMARKET"
        hint={(category) => `Transactions get ${category}`}
      />,
    )

    expect(screen.getByText('Transactions get SUPERMARKET')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Category'))
    await user.click(
      within(await screen.findByRole('list', { name: 'Category' })).getByText('Restaurants'),
    )

    expect(screen.getByText('Transactions get RESTAURANTS')).toBeInTheDocument()
  })

  it('renders no hint when none is given', () => {
    renderWithQuery(<CategoryRuleForm initialCategory="SUPERMARKET" />)

    expect(screen.getByLabelText('Search term')).toBeInTheDocument()
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
  })
})
