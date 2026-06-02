import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, ChevronLeft } from 'lucide-react'

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
  {
    forKey: 'attributions.for.commerzbankLogo',
    textKey: 'attributions.text.commerzbankLogo',
    titleKey: 'attributions.linkTitle.commerzbankLogo',
    href: 'https://companieslogo.com/de/commerzbank/logo/',
  },
  {
    forKey: 'attributions.for.dfsLogo',
    textKey: 'attributions.text.dfsLogo',
    titleKey: 'attributions.linkTitle.dfsLogo',
    href: 'https://www.youtube.com/channel/UC0Gp2sTjIcV-vYT1wzG8yxw',
  },
  {
    forKey: 'attributions.for.dkbLogo',
    textKey: 'attributions.text.dkbLogo',
    titleKey: 'attributions.linkTitle.dkbLogo',
    href: 'https://www.mygermanfinances.de/dkb-logo-square-2/',
  },
  {
    forKey: 'attributions.for.fin4uLogo', // gitleaks:allow — i18n key, not a secret
    textKey: 'attributions.text.fin4uLogo',
    titleKey: 'attributions.linkTitle.fin4uLogo',
    href: 'https://play.google.com/store/apps/details?id=de.alteleipziger.fin4u&hl=de',
  },
  {
    forKey: 'attributions.for.ingLogo',
    textKey: 'attributions.text.ingLogo',
    titleKey: 'attributions.linkTitle.ingLogo',
    href: 'https://play.google.com/store/apps/details?id=com.ingcb.mobile.cbportal&hl=de',
  },
  {
    forKey: 'attributions.for.sparkasseLogo',
    textKey: 'attributions.text.sparkasseLogo',
    titleKey: 'attributions.linkTitle.sparkasseLogo',
    href: 'https://de.wikipedia.org/wiki/Datei:Logo-_Sparkassen-App_%E2%80%93_die_mobile_Filiale.png',
  },
  {
    forKey: 'attributions.for.tradeRepublicLogo',
    textKey: 'attributions.text.tradeRepublicLogo',
    titleKey: 'attributions.linkTitle.tradeRepublicLogo',
    href: 'https://www.mygermanfinances.de/trade-republic-square-logo-2/',
  },
  {
    forKey: 'attributions.for.volksbankLogo',
    textKey: 'attributions.text.volksbankLogo',
    titleKey: 'attributions.linkTitle.volksbankLogo',
    href: 'https://www.facebook.com/VereinigteVolksbankRaiffeisenbankeG/',
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
              className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
            >
              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
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
