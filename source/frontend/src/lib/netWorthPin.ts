export const STORAGE_KEY = 'netWorth.pinnedDate'

export function readPinnedDate(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage?.getItem(STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function writePinnedDate(date: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (date == null) window.sessionStorage?.removeItem(STORAGE_KEY)
    else window.sessionStorage?.setItem(STORAGE_KEY, date)
  } catch {
    // Ignore storage being unavailable (private mode, quota, etc.).
  }
}
