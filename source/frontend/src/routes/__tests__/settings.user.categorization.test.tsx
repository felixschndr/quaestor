import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

import { SettingsCategorizationView } from '@/pages/settings.user.categorization'
import { CategoryCatalogProvider } from '@/lib/categoryCatalog'
import type { CategorizationRead } from '@/lib/categorization'
import { jsonResponse, renderWithQuery } from './-settingsUserTestHelpers'
import { DATETIME_RECENT } from '@/test/constants'

function buildCategorization(overrides: Partial<CategorizationRead> = {}): CategorizationRead {
  return {
    rules: [],
    default_matchers: [
      { pattern: 'rewe', category: 'SUPERMARKET', disabled: false },
      { pattern: 'spotify', category: 'STREAMING', disabled: true },
    ],
    recategorized: 0,
    ...overrides,
  }
}

function requestsTo(url: string, method: string) {
  return (globalThis.fetch as Mock).mock.calls.filter(
    ([calledUrl, init]) => calledUrl === url && init?.method === method,
  )
}

beforeEach(async () => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch
  document.cookie = ''
  await i18n.changeLanguage('en')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SettingsCategorizationView', () => {
  it('lists the rules and shows switched off default matchers as unchecked', async () => {
    ;(globalThis.fetch as Mock).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: 200,
          body: buildCategorization({
            rules: [
              {
                id: 1,
                pattern: 'kleinanzeigen',
                category: 'PRIVATE_SALES',
                created_at: DATETIME_RECENT,
              },
            ],
          }),
        }),
      ),
    )

    renderWithQuery(<SettingsCategorizationView />)

    expect(await screen.findByText('kleinanzeigen')).toBeInTheDocument()
    expect(screen.getByText('Private sales')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'rewe' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'spotify' })).toHaveAttribute('aria-checked', 'false')
  })

  it('creates a rule and reports how many transactions it recategorized', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/categorization/rules' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 201,
            body: buildCategorization({
              rules: [
                {
                  id: 3,
                  pattern: 'computer',
                  category: 'PRIVATE_SALES',
                  created_at: DATETIME_RECENT,
                },
              ],
              recategorized: 2,
            }),
          }),
        )
      }
      return Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() }))
    })

    renderWithQuery(<SettingsCategorizationView />)
    await screen.findByText('Supermarket')

    await user.type(screen.getByLabelText('Search term'), 'Computer')
    await user.click(screen.getByLabelText('Category'))
    await user.click(
      within(await screen.findByRole('list', { name: 'Category' })).getByText('Private sales'),
    )
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByText('computer')).toBeInTheDocument()
    const [[, init]] = requestsTo('/api/categorization/rules', 'POST')
    expect(JSON.parse(init.body)).toEqual({ pattern: 'Computer', category: 'PRIVATE_SALES' })
    expect(toastSuccess).toHaveBeenCalledWith('Rule saved · 2 transactions recategorized')
  })

  it('lists an own rule above the default rules of its category, marked as one of yours', async () => {
    ;(globalThis.fetch as Mock).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: 200,
          body: buildCategorization({
            rules: [
              { id: 1, pattern: 'kaufland', category: 'SUPERMARKET', created_at: DATETIME_RECENT },
            ],
          }),
        }),
      ),
    )

    renderWithQuery(<SettingsCategorizationView />)

    const supermarket = (await screen.findByText('Supermarket')).closest('details') as HTMLElement
    expect(supermarket).toHaveAttribute('open')
    expect(
      within(supermarket)
        .getAllByRole('listitem')
        .map((row) => row.querySelector('span')?.textContent),
    ).toEqual(['kaufland', 'rewe'])
    expect(within(supermarket).getByText('your rule')).toBeInTheDocument()
    expect(within(supermarket).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('groups the default matchers by category, collapsed until opened', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: 200,
          body: buildCategorization({
            default_matchers: [
              { pattern: 'rewe', category: 'SUPERMARKET', disabled: false },
              { pattern: 'spotify', category: 'STREAMING', disabled: true },
              { pattern: 'aldi', category: 'SUPERMARKET', disabled: false },
            ],
          }),
        }),
      ),
    )

    renderWithQuery(<SettingsCategorizationView />)

    const supermarket = (await screen.findByText('Supermarket')).closest('details') as HTMLElement
    expect(supermarket).not.toHaveAttribute('open')
    expect(
      [...document.querySelectorAll('details summary span:not([class*="ml-auto"])')]
        .map((heading) => heading.textContent)
        .filter((label) => label === 'Streaming' || label === 'Supermarket'),
    ).toEqual(['Streaming', 'Supermarket'])
    expect(within(supermarket).getByText('2 search terms')).toBeInTheDocument()
    expect(
      within(screen.getByText('Streaming').closest('details') as HTMLElement).getByText(
        '1 search term · 1 off',
      ),
    ).toBeInTheDocument()

    await user.click(within(supermarket).getByText('Supermarket'))

    expect(supermarket).toHaveAttribute('open')
    expect(
      within(supermarket)
        .getAllByRole('switch')
        .map((toggle) => toggle.getAttribute('aria-label')),
    ).toEqual(['rewe', 'aldi'])
  })

  it('opens the groups that match a search', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(() =>
      Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() })),
    )

    renderWithQuery(<SettingsCategorizationView />)
    await screen.findByText('Supermarket')

    await user.type(screen.getByLabelText('Search'), 'rewe')

    expect(screen.getByText('Supermarket').closest('details')).toHaveAttribute('open')
    expect(screen.queryByText('Streaming')).not.toBeInTheDocument()
  })

  it('lists custom categories alphabetically and labels their parts', async () => {
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/categorization/custom-categories') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              custom_categories: [
                { key: 'CUSTOM_00000001', group: 'PETS', name: 'Zooladen', owned: true },
                { key: 'CUSTOM_00000002', group: 'FOOD_AND_DRINK', name: 'Bio-Laden', owned: true },
                { key: 'CUSTOM_00000003', group: 'PETS', name: 'Fremde', owned: false },
              ],
              recategorized: 0,
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() }))
    })

    renderWithQuery(
      <CategoryCatalogProvider enabled>
        <SettingsCategorizationView />
      </CategoryCatalogProvider>,
    )

    const row = (await screen.findByText('Bio-Laden')).closest('li') as HTMLElement
    expect(
      within(row)
        .getAllByRole('term')
        .map((term) => term.textContent),
      // The name carries a short label for phones next to the long one
    ).toEqual(['NameCategory name', 'Group'])
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    const list = row.closest('ul') as HTMLElement
    const names = within(list)
      .getAllByRole('definition')
      .map((definition) => definition.textContent)
    expect(names).toEqual(['Bio-Laden', 'Food & drink', 'Zooladen', 'Pets'])
  })

  it('warns that a deletion leaves the transactions uncategorized', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation((url: string) => {
      if (url === '/api/categorization/custom-categories') {
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: {
              custom_categories: [
                { key: 'CUSTOM_00000001', group: 'PETS', name: 'Zooladen', owned: true },
              ],
              recategorized: 0,
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() }))
    })

    renderWithQuery(
      <CategoryCatalogProvider enabled>
        <SettingsCategorizationView />
      </CategoryCatalogProvider>,
    )
    const row = (await screen.findByText('Zooladen')).closest('li') as HTMLElement

    await user.click(within(row).getByRole('button', { name: 'Delete' }))

    expect(
      screen.getByRole('button', { name: 'Delete? Transactions fall back to “Unknown”' }),
    ).toBeInTheDocument()
  })

  it('adds a custom category and offers it for rules', async () => {
    const user = userEvent.setup()
    let customCategories: unknown[] = []
    ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) => {
      if (url === '/api/categorization/custom-categories') {
        if (init?.method === 'POST') {
          customCategories = [
            { key: 'CUSTOM_0A1B2C3D', group: 'FOOD_AND_DRINK', name: 'Bio-Laden', owned: true },
          ]
          return Promise.resolve(
            jsonResponse({
              status: 201,
              body: { custom_categories: customCategories, recategorized: 0 },
            }),
          )
        }
        return Promise.resolve(
          jsonResponse({
            status: 200,
            body: { custom_categories: customCategories, recategorized: 0 },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() }))
    })

    renderWithQuery(
      <CategoryCatalogProvider enabled>
        <SettingsCategorizationView />
      </CategoryCatalogProvider>,
    )
    await screen.findByText('No categories of your own yet.')

    await user.type(screen.getByLabelText('Category name'), 'Bio-Laden')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByText('Bio-Laden')).toBeInTheDocument()
    const [[, init]] = requestsTo('/api/categorization/custom-categories', 'POST')
    expect(JSON.parse(init.body)).toEqual({ group: 'FOOD_AND_DRINK', name: 'Bio-Laden' })

    await user.click(screen.getAllByLabelText('Category')[0])
    const options = await screen.findByRole('list', { name: 'Category' })
    const entries = within(options)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(entries.indexOf('Bio-Laden')).toBe(entries.indexOf('Food delivery') + 1)
  })

  it('switches a default matcher off', async () => {
    const user = userEvent.setup()
    ;(globalThis.fetch as Mock).mockImplementation(() =>
      Promise.resolve(jsonResponse({ status: 200, body: buildCategorization() })),
    )

    renderWithQuery(<SettingsCategorizationView />)
    await user.click(await screen.findByRole('switch', { name: 'rewe' }))

    await waitFor(() =>
      expect(requestsTo('/api/categorization/default-matchers', 'PUT')).toHaveLength(1),
    )
    const [[, init]] = requestsTo('/api/categorization/default-matchers', 'PUT')
    expect(JSON.parse(init.body)).toEqual({ pattern: 'rewe', disabled: true })
  })
})
