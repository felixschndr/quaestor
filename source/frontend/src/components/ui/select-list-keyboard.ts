import type { KeyboardEvent } from 'react'

export function handleSelectListArrowKeys(event: KeyboardEvent<HTMLElement>) {
  const { key } = event
  if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-select-row]')]
  if (rows.length === 0) return
  event.preventDefault()
  const current = rows.indexOf(document.activeElement as HTMLElement)
  const next =
    key === 'Home'
      ? 0
      : key === 'End'
        ? rows.length - 1
        : key === 'ArrowDown'
          ? Math.min(current + 1, rows.length - 1)
          : Math.max(current - 1, 0)
  rows[next]?.focus()
}
