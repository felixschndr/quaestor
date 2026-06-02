import { describe, expect, it } from 'vitest'
import { ibanToBlz, isLikelyIban, initials, monogramColor } from '@/lib/bankIdentity'

describe('ibanToBlz', () => {
  it('extracts the bank code from a German IBAN (chars 5-12)', () => {
    expect(ibanToBlz('DE89 3704 0044 0532 0130 00')).toBe('37040044')
  })
  it('returns null for non-German or too-short input', () => {
    expect(ibanToBlz('FR7630006000011234567890189')).toBeNull()
    expect(ibanToBlz('DE89')).toBeNull()
  })
})

describe('isLikelyIban', () => {
  it('is true for something starting with two letters then digits', () => {
    expect(isLikelyIban('DE89370400440532013000')).toBe(true)
    expect(isLikelyIban('de89 3704')).toBe(true)
  })
  it('is false for plain digits or a name', () => {
    expect(isLikelyIban('37040044')).toBe(false)
    expect(isLikelyIban('Sparkasse')).toBe(false)
  })
})

describe('initials', () => {
  it('takes the first letters of the first two words, uppercased', () => {
    expect(initials('Stadtsparkasse München')).toBe('SM')
    expect(initials('Commerzbank')).toBe('CO')
    expect(initials('')).toBe('?')
  })
})

describe('monogramColor', () => {
  it('is deterministic for the same seed and a valid hsl string', () => {
    expect(monogramColor('37040044')).toBe(monogramColor('37040044'))
    expect(monogramColor('37040044')).toMatch(/^hsl\(\d{1,3} \d{1,3}% \d{1,3}%\)$/)
  })
})
