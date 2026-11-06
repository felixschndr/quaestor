import type React from 'react'

interface LocationMock {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
}

export function mockHref({ to, params, search }: LocationMock): string {
  let href = to
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, value)
    }
  }
  if (search) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      if (value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) {
        query.append(key, String(item))
      }
    }
    const queryString = query.toString()
    if (queryString) href = `${href}?${queryString}`
  }
  return href
}

export function LinkMock({
  to,
  params,
  search,
  replace,
  children,
  ...rest
}: {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  replace?: boolean
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) {
  return (
    <a href={mockHref({ to, params, search })} data-replace={replace || undefined} {...rest}>
      {children}
    </a>
  )
}

export const routeState: { params: Record<string, string>; search: Record<string, unknown> } = {
  params: {},
  search: {},
}

export function routerMocks(overrides: Record<string, unknown> = {}) {
  return {
    Link: LinkMock,
    createFileRoute: () => (options: object) => ({
      options,
      useParams: () => routeState.params,
      useSearch: () => routeState.search,
    }),
    useCanGoBack: () => false,
    useRouter: () => ({
      history: { back: () => {}, push: () => {} },
      buildLocation: (location: LocationMock) => ({ href: mockHref(location) }),
    }),
    ...overrides,
  }
}

export function NavLinkMock({
  activeOptions: _activeOptions,
  activeProps: _activeProps,
  ...props
}: Parameters<typeof LinkMock>[0] & { activeOptions?: unknown; activeProps?: unknown }) {
  return <LinkMock {...props} />
}
