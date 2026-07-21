import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronRight } from 'lucide-react'

import { type SupportedBank, bankDisplayName, viaHandlerLabel } from '@/lib/credentials'
import { ibanToBlz, isLikelyIban } from '@/lib/bankIdentity'
import { BankLogo } from '@/components/BankLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BackLink } from '@/components/back-link'
import { BANK_HANDLERS_DOCS_URL } from '@/lib/links'

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
        .sort((a, b) => bankDisplayName(t, a).localeCompare(bankDisplayName(t, b))),
    [banks, t],
  )
  const matches = useMemo(() => filterBanks(catalog, query), [catalog, query])

  return (
    <main className="mx-auto flex min-h-full max-w-page flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink to="/settings/credentials" />
        <h1 className="text-foreground text-2xl font-semibold">{t('credentials.pickerTitle')}</h1>
        <Button asChild variant="primary" size="sm" className="ml-auto">
          <a href={BANK_HANDLERS_DOCS_URL} target="_blank" rel="noopener noreferrer">
            <BookOpen className="size-4" aria-hidden="true" />
            {t('credentials.pickerDocs')}
          </a>
        </Button>
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
        <div className="flex flex-col gap-3">
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
            <VirtualBankList matches={matches} existingAccountCounts={existingAccountCounts} />
          )}
        </div>
      )}
    </main>
  )
}

function VirtualBankList({
  matches,
  existingAccountCounts,
}: {
  matches: SupportedBank[]
  existingAccountCounts: Record<string, number>
}) {
  const listRef = useRef<HTMLUListElement>(null)
  // The page itself scrolls, so the virtualizer needs to know where the list starts.
  const [listTop, setListTop] = useState(0)
  useLayoutEffect(() => setListTop(listRef.current?.offsetTop ?? 0), [])
  const virtualizer = useWindowVirtualizer({
    count: matches.length,
    estimateSize: () => 64,
    overscan: 8,
    scrollMargin: listTop,
  })
  return (
    <ul ref={listRef} className="border-border bg-card rounded-lg border">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const bank = matches[item.index]
          return (
            <BankRow
              key={bank.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              bank={bank}
              accountsCount={
                bank.provider === bank.key ? (existingAccountCounts[bank.provider] ?? 0) : null
              }
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start - listTop}px)`,
              }}
            />
          )
        })}
      </div>
    </ul>
  )
}

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

const DIRECT_PROVIDERS = new Set(['dfs', 'trade_republic', 'fin4u'])

function handlerBadge(provider: string): { key: string; handler?: string } | null {
  const via = viaHandlerLabel(provider)
  if (via) return { key: 'credentials.viaHandler', handler: via }
  if (DIRECT_PROVIDERS.has(provider)) return { key: 'credentials.directHandler' }
  return null
}

function bankSubtitle(bank: SupportedBank): string | null {
  const parts: string[] = []
  if (bank.blzs.length === 1) parts.push(bank.blzs[0])
  else if (bank.blzs.length > 1) parts.push(`${bank.blzs[0]} +${bank.blzs.length - 1}`)
  if (bank.bic) parts.push(bank.bic)
  return parts.length > 0 ? parts.join(' · ') : null
}

const BankRow = forwardRef<
  HTMLLIElement,
  {
    bank: SupportedBank
    accountsCount: number | null
    style?: React.CSSProperties
    'data-index'?: number
  }
>(function BankRow({ bank, accountsCount, ...rest }, ref) {
  const { t } = useTranslation()
  const name = bankDisplayName(t, bank)
  const subtitle = bankSubtitle(bank)
  const badge = handlerBadge(bank.provider)
  return (
    <li ref={ref} {...rest} className="border-border/40 border-t">
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
            {badge ? (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                {t(badge.key, { handler: badge.handler })}
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
})
