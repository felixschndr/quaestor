import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'

export const Route = createFileRoute('/settings/attributions')({
  component: SettingsAttributionsPage,
})

interface Attribution {
  /** What this credit covers (e.g. "Favicon"). */
  forKey: string
  /** Localised credit text shown as the link content. */
  textKey: string
  /** Native `title` attribute on the link. */
  titleKey: string
  href: string
}

// Single source of truth for the list. Add new entries here as third-party
// assets are introduced. Each entry is a single clickable credit line.
const ATTRIBUTIONS: Attribution[] = [
  {
    forKey: 'attributions.for.favicon',
    textKey: 'attributions.text.faviconMoneyIcons',
    titleKey: 'attributions.linkTitle.moneyIcons',
    href: 'https://www.flaticon.com/free-icons/money',
  },
  {
    forKey: 'attributions.for.manualBank',
    textKey: 'attributions.text.manualWritingIcons',
    titleKey: 'attributions.linkTitle.writingIcons',
    href: 'https://www.flaticon.com/free-icons/writing',
  },
]

export function SettingsAttributionsPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink />
        <h1 className="text-foreground text-2xl font-semibold">{t('attributions.title')}</h1>
      </header>

      <ul className="border-border bg-card flex flex-col rounded-lg border">
        {ATTRIBUTIONS.map((attribution) => (
          <li
            key={attribution.href}
            className="border-border/40 flex flex-col gap-1 border-t px-3 py-3 first:border-t-0"
          >
            <span className="text-muted-foreground text-xs">{t(attribution.forKey)}</span>
            <a
              href={attribution.href}
              title={t(attribution.titleKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm hover:underline"
            >
              {t(attribution.textKey)}
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link
      to="/settings"
      aria-label={t('settings.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
