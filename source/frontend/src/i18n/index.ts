import { useEffect } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import de from './locales/de.json'

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function isSupportedLanguage(value: string | undefined): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  })

/**
 * Apply the authenticated user's stored language preference to i18next.
 *
 * Until /auth/me resolves, the active language comes solely from the
 * `LanguageDetector` (localStorage → navigator → fallback). That can disagree
 * with the user's saved preference — e.g. on a fresh device, or when the
 * preference was changed from another browser. This hook reconciles the two:
 * once the user's language is known, it becomes the source of truth. i18next's
 * detector caches it back to localStorage, so the next bootstrap picks it up
 * before this hook even runs.
 *
 * Pass the value from `useAuthMe().data?.language`; `undefined` (not yet
 * loaded / logged out) is a no-op so the detector's choice stands.
 */
export function useApplyUserLanguage(language: string | undefined): void {
  useEffect(() => {
    if (!isSupportedLanguage(language)) return
    if (i18n.language === language) return
    void i18n.changeLanguage(language)
  }, [language])
}

export default i18n
