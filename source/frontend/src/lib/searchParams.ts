import { z } from 'zod'

export function oneOrMany<T extends z.ZodType>(schema: T) {
  return z
    .union([z.array(schema), schema])
    .transform((value) => (Array.isArray(value) ? value : [value]))
}

export function appendParams(params: URLSearchParams, entries: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
      continue
    }
    if (typeof value === 'string' && value.length === 0) continue
    params.append(key, String(value))
  }
}
