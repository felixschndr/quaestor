/** Helpers to identify a German bank from a BLZ/IBAN and to render a fallback
 *  monogram when no logo image exists. All pure, no I/O. */

const normalize = (value: string): string => value.replace(/\s+/g, '').toUpperCase()

/** Bank code (Bankleitzahl) of a German IBAN: positions 5-12 (after "DE" + 2 check digits).
 *  Returns null when the input is not a plausible German IBAN. */
export function ibanToBlz(iban: string): string | null {
  const normalized = normalize(iban)
  if (!/^DE\d{20}$/.test(normalized)) return null
  return normalized.slice(4, 12)
}

/** True when the input looks like the start of an IBAN (two letters then a digit),
 *  used to decide whether a search query should be treated as an IBAN. */
export function isLikelyIban(value: string): boolean {
  return /^[A-Za-z]{2}\d/.test(normalize(value))
}

/** Up to two uppercase initials from the first two words of a bank name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Deterministic, pleasant background colour derived from a seed (BLZ or name). */
export function monogramColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${hash} 55% 45%)`
}
