import { useEffect } from 'react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import de from './locales/de.json'

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function isSupportedLanguage(value: string | undefined): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
}

i18n.on('languageChanged', (lng) => localStorage.setItem('i18nextLng', lng))

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: localStorage.getItem('i18nextLng') ?? navigator.language.slice(0, 2),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
})

export function useApplyUserLanguage(language: string | undefined): void {
  useEffect(() => {
    if (!isSupportedLanguage(language)) return
    if (i18n.language === language) return
    void i18n.changeLanguage(language)
  }, [language])
}

export default i18n
