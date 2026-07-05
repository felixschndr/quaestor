import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import i18n from 'i18next'

import { Section, SettingsSubPage } from '@/components/settings/settings-section'
import { SingleSelectPopover } from '@/components/ui/single-select-popover'
import { readApiErrorMessage } from '@/lib/apiError'
import { type Theme, type UserRead } from '@/lib/auth'
import { useSupportedLanguages, useUpdateUser } from '@/lib/user'
import { applyTheme, THEME_VALUES } from '@/lib/theme'

export function SettingsAppearanceView({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  return (
    <SettingsSubPage title={t('settings.appearance')}>
      <LanguageSection user={user} />
      <ThemeSection user={user} />
    </SettingsSubPage>
  )
}

function LanguageSection({ user }: { user: UserRead }) {
  const { t, i18n: i18next } = useTranslation()
  const { data: languages } = useSupportedLanguages()
  const update = useUpdateUser(user.id)
  const [pending, setPending] = useState(false)

  const change = async (next: string) => {
    if (next === user.language) return
    setPending(true)
    try {
      await update.mutateAsync({ language: next })
      // Switch i18next immediately so the rest of the UI re-renders without a reload.
      await i18n.changeLanguage(next)
      toast.success(t('settings.userSaved'))
    } catch (err) {
      toast.error(readApiErrorMessage(err, t))
    } finally {
      setPending(false)
    }
  }

  // Sort alphabetically by the localised label in the user's current UI
  // language, so the order matches what they actually read on screen.
  const sortedLanguages = [...(languages?.languages ?? [user.language])]
    .map((code) => ({ code, label: t(`languages.${code}`, { defaultValue: code }) }))
    .sort((a, b) => a.label.localeCompare(b.label, i18next.language))

  return (
    <Section title={t('settings.language')}>
      <div className="flex flex-col gap-2">
        <SingleSelectPopover
          id="language-select"
          ariaLabel={t('settings.language')}
          value={user.language}
          disabled={pending || !languages}
          onChange={(next) => void change(next)}
          options={sortedLanguages.map(({ code, label }) => ({ value: code, label }))}
        />
      </div>
    </Section>
  )
}

function ThemeSection({ user }: { user: UserRead }) {
  const { t } = useTranslation()
  const update = useUpdateUser(user.id)
  const [pending, setPending] = useState(false)

  const change = async (next: Theme) => {
    if (next === user.theme) return

    applyTheme(next)
    setPending(true)
    try {
      await update.mutateAsync({ theme: next })
      toast.success(t('settings.userSaved'))
    } catch (err) {
      applyTheme(user.theme)
      toast.error(readApiErrorMessage(err, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <Section title={t('settings.theme')}>
      <div className="flex flex-col gap-2">
        <SingleSelectPopover
          id="theme-select"
          ariaLabel={t('settings.theme')}
          value={user.theme}
          disabled={pending}
          onChange={(next) => void change(next)}
          options={THEME_VALUES.map((value) => ({
            value,
            label: t(`settings.theme${value.charAt(0)}${value.slice(1).toLowerCase()}`),
          }))}
        />
      </div>
    </Section>
  )
}
