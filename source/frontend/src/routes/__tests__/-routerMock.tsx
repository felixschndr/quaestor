import type React from 'react'

export function LinkMock({
  to,
  params,
  search,
  children,
  ...rest
}: {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>) {
  let href = to
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, value)
    }
  }
  if (search) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        query.append(key, String(item))
      }
    }
    const queryString = query.toString()
    if (queryString) href = `${href}?${queryString}`
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

export function routerMocks(overrides: Record<string, unknown> = {}) {
  return {
    Link: LinkMock,
    createFileRoute: () => () => ({}),
    ...overrides,
  }
}
