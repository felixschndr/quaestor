import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TFunction } from 'i18next'

import { type SupportedBank } from '@/lib/credentials'
import { countryName, ibanToBlz, isLikelyIban } from '@/lib/bankIdentity'
import { BankLogo } from '@/components/BankLogo'
import { Input } from '@/components/ui/input'

export interface BankPickerViewProps {
  isLoading: boolean
  isError: boolean
  banks: SupportedBank[]
  existingAccountCounts: Record<string, number>
  query: string
  onSearch: (value: string) => void
}

export function BankPickerView({
  isLoading,
  isError,
  banks,
  existingAccountCounts,
  query,
  onSearch,
}: BankPickerViewProps) {
  const { t } = useTranslation()
  // "manual" is pinned to the top as its own box (the escape hatch for unlisted banks),
  // so it is kept out of the searchable catalog below.
  const manualBank = banks.find((bank) => bank.provider === 'manual') ?? null
  const catalog = useMemo(
    () =>
      banks
        .filter((bank) => bank.provider !== 'manual')
        .sort((a, b) => displayName(t, a).localeCompare(displayName(t, b))),
    [banks, t],
  )
  const matches = useMemo(() => filterBanks(catalog, query), [catalog, query])

  return (
    <main className="mx-auto flex h-dvh max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings/credentials" />
        <h1 className="text-foreground text-2xl font-semibold">{t('credentials.pickerTitle')}</h1>
      </header>
      <Input
        type="search"
        value={query}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t('credentials.searchPlaceholder')}
        aria-label={t('credentials.searchPlaceholder')}
      />
      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-destructive text-sm">{t('login.genericError')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {manualBank ? (
            <ul className="border-border bg-card flex flex-col rounded-lg border">
              <BankRow
                bank={manualBank}
                accountsCount={existingAccountCounts[manualBank.provider] ?? 0}
              />
            </ul>
          ) : null}
          {matches.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('credentials.noResults')}</p>
          ) : (
            // The list grows only as tall as its rows; once it would exceed the remaining
            // height it stops there (min-h-0) and scrolls instead of stretching past it.
            <ul className="border-border bg-card flex min-h-0 flex-col overflow-y-auto rounded-lg border">
              {matches.map((bank) => (
                <BankRow
                  key={bank.key}
                  bank={bank}
                  accountsCount={
                    bank.provider === bank.key ? (existingAccountCounts[bank.provider] ?? 0) : null
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  )
}

function displayName(t: TFunction, bank: SupportedBank): string {
  return bank.provider === bank.key
    ? t(`banks.${bank.provider}.title`, { defaultValue: bank.name })
    : bank.name
}

/** Slug for name matching on both sides (query AND bank name): lowercased, diacritics
 *  folded (ü → u), everything non-alphanumeric dropped — so "ING DiBa", "ing-diba" and
 *  "ingdiba" all find "ING-DiBa". */
function searchSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function bankMatches(
  bank: SupportedBank,
  slug: string,
  digits: string,
  ibanBlz: string | null,
): boolean {
  return (
    (slug !== '' && searchSlug(bank.name).includes(slug)) ||
    (/^\d+$/.test(digits) && bank.blzs.some((blz) => blz.startsWith(digits))) ||
    (ibanBlz !== null && bank.blzs.includes(ibanBlz))
  )
}

function filterBanks(banks: SupportedBank[], query: string): SupportedBank[] {
  const slug = searchSlug(query)
  if (slug === '' && query.trim() === '') return banks
  const digits = query.replace(/\s/g, '')
  const ibanBlz = isLikelyIban(query) ? ibanToBlz(query) : null
  return banks.filter((bank) => bankMatches(bank, slug, digits, ibanBlz))
}

const HANDLER_LABELS: Record<string, string> = {
  fints: 'FinTS',
  enable_banking: 'Enable Banking',
}

function bankSubtitle(bank: SupportedBank, locale: string): string | null {
  if (bank.countries?.length === 1) return countryName(bank.countries[0], locale)
  const parts: string[] = []
  if (bank.blzs.length === 1) parts.push(bank.blzs[0])
  else if (bank.blzs.length > 1) parts.push(`${bank.blzs[0]} +${bank.blzs.length - 1}`)
  if (bank.bic) parts.push(bank.bic)
  return parts.length > 0 ? parts.join(' · ') : null
}

function BankRow({ bank, accountsCount }: { bank: SupportedBank; accountsCount: number | null }) {
  const { t, i18n } = useTranslation()
  const name = displayName(t, bank)
  const subtitle = bankSubtitle(bank, i18n.language)
  const handlerLabel = HANDLER_LABELS[bank.provider]
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <Link
        to="/settings/credentials/new/$bank"
        params={{ bank: bank.key }}
        className="hover:bg-muted/60 flex items-center gap-3 rounded-md px-3 py-3 transition-colors"
      >
        <BankLogo icon={bank.icon} name={name} seed={bank.key} />
        <span className="flex flex-1 flex-col">
          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
            {name}
            {bank.tested ? (
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                {t('credentials.tested')}
              </span>
            ) : null}
            {handlerLabel ? (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                {handlerLabel}
              </span>
            ) : null}
          </span>
          {subtitle ? <span className="text-muted-foreground text-xs">{subtitle}</span> : null}
          {accountsCount !== null ? (
            <span className="text-muted-foreground text-xs">
              {t('credentials.pickerAccountsAdded', { count: accountsCount })}
            </span>
          ) : null}
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </li>
  )
}

function BackLink({ to }: { to: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      aria-label={t('common.back')}
      className="text-primary hover:text-primary/80 -ml-1.5 cursor-pointer rounded-md p-1.5 transition-colors"
    >
      <ChevronLeft className="size-5" />
    </Link>
  )
}
