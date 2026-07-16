import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { BackLink } from '@/components/back-link'

interface Attribution {
  textKey: string
  href: string
}

const ATTRIBUTIONS: Attribution[] = [
  {
    textKey: 'attributions.text.faviconMoneyIcons',
    href: 'https://www.flaticon.com/free-icons/money',
  },
  {
    textKey: 'attributions.text.manualWritingIcons',
    href: 'https://www.flaticon.com/free-icons/writing',
  },
  {
    textKey: 'attributions.text.commerzbankLogo',
    href: 'https://companieslogo.com/de/commerzbank/logo/',
  },
  {
    textKey: 'attributions.text.deutscheBankLogo',
    href: 'https://www.cleanpng.com/png-deutsche-bank-finance-loan-transaction-authenticat-znbniq/download-png.html',
  },
  {
    textKey: 'attributions.text.dfsLogo',
    href: 'https://www.youtube.com/channel/UC0Gp2sTjIcV-vYT1wzG8yxw',
  },
  {
    textKey: 'attributions.text.dkbLogo',
    href: 'https://www.mygermanfinances.de/dkb-logo-square-2/',
  },
  {
    textKey: 'attributions.text.fin4uLogo',
    href: 'https://play.google.com/store/apps/details?id=de.alteleipziger.fin4u&hl=de',
  },
  {
    textKey: 'attributions.text.hypovereinsbankLogo',
    href: 'https://www.facebook.com/Hypovereinsbankag/',
  },
  {
    textKey: 'attributions.text.ingLogo',
    href: 'https://play.google.com/store/apps/details?id=com.ingcb.mobile.cbportal&hl=de',
  },
  {
    textKey: 'attributions.text.n26Logo',
    href: 'https://n26.com/en-eu/logo-assets',
  },
  {
    textKey: 'attributions.text.paypalLogo',
    href: 'https://www.flaticon.com/de/kostenloses-icon/paypal_174861',
  },
  {
    textKey: 'attributions.text.revolutLogo',
    href: 'https://icons8.de/icons/set/revolut-logo',
  },
  {
    textKey: 'attributions.text.sparkasseLogo',
    href: 'https://de.wikipedia.org/wiki/Datei:Logo-_Sparkassen-App_%E2%80%93_die_mobile_Filiale.png',
  },
  {
    textKey: 'attributions.text.tradeRepublicLogo',
    href: 'https://www.mygermanfinances.de/trade-republic-square-logo-2/',
  },
  {
    textKey: 'attributions.text.volksbankLogo',
    href: 'https://www.facebook.com/VereinigteVolksbankRaiffeisenbankeG/',
  },
]

export function SettingsAttributionsPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings" />
        <h1 className="text-foreground text-2xl font-semibold">{t('attributions.title')}</h1>
      </header>

      <ul className="border-border bg-card flex flex-col rounded-lg border">
        {ATTRIBUTIONS.map((attribution) => (
          <li
            key={attribution.href}
            className="border-border/40 flex flex-col gap-1 border-t px-3 py-3 first:border-t-0"
          >
            <a
              href={attribution.href}
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
