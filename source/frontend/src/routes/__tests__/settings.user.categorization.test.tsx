import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import i18n from 'i18next'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

import { SettingsCategorizationView } from '@/pages/settings.user.categorization'
import { CategoryCatalogProvider } from '@/lib/categoryCatalog'
import type { CategorizationRead, CategoryRuleRead, CustomCategoryRead } from '@/lib/categorization'
import { Route } from '@/routes/settings.user.categorization'
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
  vi.clearAllMocks()
})

const OWN_RULE: CategoryRuleRead = {
  id: 1,
  pattern: 'kaufland',
  category: 'SUPERMARKET',
  created_at: DATETIME_RECENT,
}
const PET_SHOP: CustomCategoryRead = {
  key: 'CUSTOM_00000001',
  group: 'PETS',
  name: 'Zooladen',
  owned: true,
}

function serve(writes: Record<string, () => Response> = {}) {
  ;(globalThis.fetch as Mock).mockImplementation((url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/categorization/custom-categories') {
      return Promise.resolve(
        jsonResponse({ status: 200, body: { custom_categories: [PET_SHOP], recategorized: 0 } }),
      )
    }
    if (method === 'GET' && url === '/api/categorization') {
      return Promise.resolve(
        jsonResponse({ status: 200, body: buildCategorization({ rules: [OWN_RULE] }) }),
      )
    }
    const write = writes[`${method} ${url}`]
    return Promise.resolve(
      write ? write() : jsonResponse({ status: 500, body: { detail: 'boom' } }),
    )
  })
}

function renderWithCatalog() {
  return renderWithQuery(
    <CategoryCatalogProvider enabled>
      <SettingsCategorizationView />
    </CategoryCatalogProvider>,
  )
}

async function petShopRow() {
  return (await screen.findByText(PET_SHOP.name)).closest('li') as HTMLElement
}

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
    expect(within(supermarket).getByText('Your rule')).toBeInTheDocument()
    expect(within(supermarket).getByText('1 own')).toBeInTheDocument()
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
    const streaming = screen.getByText('Streaming').closest('details') as HTMLElement
    expect(within(streaming).getByText('1 search term')).toBeInTheDocument()
    expect(within(streaming).getByText('1 off')).toBeInTheDocument()

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
    expect(entries.indexOf('Bio-Laden')).toBe(entries.indexOf('Food delivery') - 1)
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

  it('collapses an open group again', async () => {
    const user = userEvent.setup()
    serve()
    renderWithQuery(<SettingsCategorizationView />)

    const supermarket = (await screen.findByText('Supermarket')).closest('details') as HTMLElement
    expect(supermarket).toHaveAttribute('open')
    await user.click(within(supermarket).getByText('Supermarket'))

    expect(supermarket).not.toHaveAttribute('open')
  })

  it('says so when no rule matches the search', async () => {
    const user = userEvent.setup()
    serve()
    renderWithQuery(<SettingsCategorizationView />)
    await screen.findByText('Supermarket')

    await user.type(screen.getByLabelText('Search'), 'no-such-merchant')

    expect(screen.getByText('No rule matches the search.')).toBeInTheDocument()
    expect(screen.queryByText('Supermarket')).not.toBeInTheDocument()
  })

  it('edits an own rule in place', async () => {
    const user = userEvent.setup()
    serve({
      'PUT /api/categorization/rules/1': () =>
        jsonResponse({
          status: 200,
          body: buildCategorization({ rules: [{ ...OWN_RULE, pattern: 'kaufland markt' }] }),
        }),
    })
    renderWithQuery(<SettingsCategorizationView />)
    const supermarket = (await screen.findByText('Supermarket')).closest('details') as HTMLElement

    await user.click(within(supermarket).getByRole('button', { name: 'Edit' }))
    const pattern = within(supermarket).getByDisplayValue('kaufland')
    await user.type(pattern, ' markt')
    await user.click(within(supermarket).getByRole('button', { name: 'Save' }))

    expect(await within(supermarket).findByText('kaufland markt')).toBeInTheDocument()
    const [[, init]] = requestsTo('/api/categorization/rules/1', 'PUT')
    expect(JSON.parse(init.body)).toEqual({ pattern: 'kaufland markt', category: 'SUPERMARKET' })
    expect(toastSuccess).toHaveBeenCalledWith('Rule saved')
    expect(within(supermarket).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('deletes an own rule after a confirm step', async () => {
    const user = userEvent.setup()
    serve({
      'DELETE /api/categorization/rules/1': () =>
        jsonResponse({ status: 200, body: buildCategorization() }),
    })
    renderWithQuery(<SettingsCategorizationView />)
    const supermarket = (await screen.findByText('Supermarket')).closest('details') as HTMLElement

    await user.click(within(supermarket).getByRole('button', { name: 'Delete' }))
    expect(requestsTo('/api/categorization/rules/1', 'DELETE')).toHaveLength(0)
    await user.click(within(supermarket).getByRole('button', { name: 'Really delete?' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Rule deleted'))
    expect(requestsTo('/api/categorization/rules/1', 'DELETE')).toHaveLength(1)
    expect(screen.queryByText('kaufland')).not.toBeInTheDocument()
  })

  it('renames a custom category in place', async () => {
    const user = userEvent.setup()
    serve({
      [`PUT /api/categorization/custom-categories/${PET_SHOP.key}`]: () =>
        jsonResponse({
          status: 200,
          body: { custom_categories: [{ ...PET_SHOP, name: 'Tierbedarf' }], recategorized: 0 },
        }),
    })
    renderWithCatalog()

    await user.click(within(await petShopRow()).getByRole('button', { name: 'Edit' }))
    const name = screen.getByDisplayValue(PET_SHOP.name)
    await user.clear(name)
    await user.type(name, 'Tierbedarf')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Tierbedarf')).toBeInTheDocument()
    const [[, init]] = requestsTo(`/api/categorization/custom-categories/${PET_SHOP.key}`, 'PUT')
    expect(JSON.parse(init.body)).toEqual({ group: 'PETS', name: 'Tierbedarf' })
    expect(toastSuccess).toHaveBeenCalledWith('Category saved')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('leaves a custom category untouched when its edit is cancelled', async () => {
    const user = userEvent.setup()
    serve()
    renderWithCatalog()

    await user.click(within(await petShopRow()).getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByDisplayValue(PET_SHOP.name), ' XL')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText(PET_SHOP.name)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(`${PET_SHOP.name} XL`)).not.toBeInTheDocument()
    expect(requestsTo(`/api/categorization/custom-categories/${PET_SHOP.key}`, 'PUT')).toHaveLength(
      0,
    )
  })

  it('deletes a custom category after the warning is confirmed', async () => {
    const user = userEvent.setup()
    serve({
      [`DELETE /api/categorization/custom-categories/${PET_SHOP.key}`]: () =>
        jsonResponse({ status: 200, body: { custom_categories: [], recategorized: 3 } }),
    })
    renderWithCatalog()

    await user.click(within(await petShopRow()).getByRole('button', { name: 'Delete' }))
    await user.click(
      screen.getByRole('button', { name: 'Delete? Transactions fall back to “Unknown”' }),
    )

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Category deleted · 3 transactions recategorized'),
    )
    expect(await screen.findByText('No categories of your own yet.')).toBeInTheDocument()
  })

  it('keeps the typed name and reports the error when adding a category fails', async () => {
    const user = userEvent.setup()
    serve()
    renderWithCatalog()
    await petShopRow()

    const name = screen.getByLabelText('Category name')
    await user.type(name, 'Bio-Laden')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    )
    expect(name).toHaveValue('Bio-Laden')
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('/settings/user/categorization route', () => {
  it('serves the categorization page', () => {
    expect(Route.options.component).toBe(SettingsCategorizationView)
  })
})
