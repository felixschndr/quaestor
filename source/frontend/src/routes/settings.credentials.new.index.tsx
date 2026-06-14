import { useMemo } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { useAuthMe } from '@/lib/auth'
import { useSupportedBanks, type SupportedBank } from '@/lib/credentials'
import { ibanToBlz, isLikelyIban } from '@/lib/bankIdentity'
import { BankLogo } from '@/components/BankLogo'
import { Input } from '@/components/ui/input'

// The picker's navigation state lives in the URL so browser back/forward works and the
// search survives a round-trip to a bank's form: `q` is the top-level search, `family` the
// drilled-into group, `fq` the search within that group.
const pickerSearchSchema = z.object({
  q: z.string().optional(),
  family: z.string().optional(),
  fq: z.string().optional(),
})

export const Route = createFileRoute('/settings/credentials/new/')({
  component: BankPickerPage,
  validateSearch: (search) => pickerSearchSchema.parse(search),
})

function BankPickerPage() {
  const banks = useSupportedBanks()
  const { data: user } = useAuthMe()
  const { q, family, fq } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const existingAccountCounts: Record<string, number> = {}
  for (const credential of user?.credentials ?? []) {
    existingAccountCounts[credential.bank] =
      (existingAccountCounts[credential.bank] ?? 0) + credential.accounts.length
  }

  return (
    <BankPickerView
      isLoading={banks.isLoading}
      isError={banks.isError}
      banks={banks.data ?? []}
      existingAccountCounts={existingAccountCounts}
      query={q ?? ''}
      family={family ?? null}
      familyQuery={fq ?? ''}
      // Typing replaces the current entry (no history spam); opening/closing a group pushes
      // one, so browser back collapses the group instead of leaving the picker.
      onSearch={(value) =>
        navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true })
      }
      // Carry the top-level query into the group so a search that surfaced a member is
      // still applied after drilling in (the user can clear it there if they want).
      onOpenFamily={(slug) =>
        navigate({ search: (prev) => ({ ...prev, family: slug, fq: prev.q || undefined }) })
      }
      onCloseFamily={() =>
        navigate({ search: (prev) => ({ ...prev, family: undefined, fq: undefined }) })
      }
      onFamilySearch={(value) =>
        navigate({ search: (prev) => ({ ...prev, fq: value || undefined }), replace: true })
      }
    />
  )
}

export interface BankPickerViewProps {
  isLoading: boolean
  isError: boolean
  banks: SupportedBank[]
  existingAccountCounts: Record<string, number>
  query: string
  family: string | null
  familyQuery: string
  onSearch: (value: string) => void
  onOpenFamily: (slug: string) => void
  onCloseFamily: () => void
  onFamilySearch: (value: string) => void
}

/** A top-level picker entry: either a single bank, or a family that groups the many
 *  local Sparkassen / Volksbanken (etc.) sharing one logo behind a single row the
 *  user drills into. */
type PickerItem =
  | { kind: 'bank'; key: string; label: string; bank: SupportedBank }
  | {
      kind: 'family'
      key: string
      slug: string
      label: string
      icon: string | null
      members: SupportedBank[]
    }

export function BankPickerView({
  isLoading,
  isError,
  banks,
  existingAccountCounts,
  query,
  family,
  familyQuery,
  onSearch,
  onOpenFamily,
  onCloseFamily,
  onFamilySearch,
}: BankPickerViewProps) {
  const { t } = useTranslation()
  // "manual" is pinned to the top as its own box (the escape hatch for unlisted banks),
  // so it is kept out of the searchable catalog below.
  const manualBank = banks.find((bank) => bank.provider === 'manual') ?? null
  const items = useMemo(
    () =>
      buildItems(
        banks.filter((bank) => bank.provider !== 'manual'),
        t,
      ),
    [banks, t],
  )
  const openFamily =
    family !== null
      ? (items.find((it) => it.kind === 'family' && it.slug === family) ?? null)
      : null

  if (openFamily && openFamily.kind === 'family') {
    return (
      <FamilyView
        family={openFamily}
        query={familyQuery}
        onQueryChange={onFamilySearch}
        onBack={onCloseFamily}
      />
    )
  }

  const matches = filterItems(items, query)

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-6 p-4">
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
              {matches.map((item) =>
                item.kind === 'family' ? (
                  <FamilyRow key={item.key} family={item} onOpen={() => onOpenFamily(item.slug)} />
                ) : (
                  <BankRow
                    key={item.key}
                    bank={item.bank}
                    accountsCount={
                      item.bank.provider === item.bank.key
                        ? (existingAccountCounts[item.bank.provider] ?? 0)
                        : null
                    }
                  />
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </main>
  )
}

function FamilyView({
  family,
  query,
  onQueryChange,
  onBack,
}: {
  family: Extract<PickerItem, { kind: 'family' }>
  query: string
  onQueryChange: (value: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const matches = useMemo(() => {
    const sorted = [...family.members].sort((a, b) => a.name.localeCompare(b.name))
    return filterBanks(sorted, query)
  }, [family.members, query])

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <BackLink onClick={onBack} />
        <BankLogo icon={family.icon} name={family.label} seed={family.slug} />
        <h1 className="text-foreground truncate text-2xl font-semibold">{family.label}</h1>
      </header>
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t('credentials.searchPlaceholder')}
        aria-label={t('credentials.searchPlaceholder')}
        autoFocus
      />
      {matches.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('credentials.noResults')}</p>
      ) : (
        <ul className="border-border bg-card flex min-h-0 flex-col overflow-y-auto rounded-lg border">
          {matches.map((bank) => (
            <BankRow key={bank.key} bank={bank} accountsCount={null} />
          ))}
        </ul>
      )}
    </main>
  )
}

function displayName(t: TFunction, bank: SupportedBank): string {
  return bank.provider === bank.key
    ? t(`banks.${bank.provider}.title`, { defaultValue: bank.name })
    : bank.name
}

/** Collapse banks that share a backend-assigned family into family rows (≥2 members);
 *  everything else stays a standalone row. The grouping is the backend's single source of
 *  truth (`bank.family`) — this only renders it. Result is sorted alphabetically by label. */
function buildItems(banks: SupportedBank[], t: TFunction): PickerItem[] {
  const byFamily = new Map<string, SupportedBank[]>()
  const standalone: SupportedBank[] = []
  for (const bank of banks) {
    if (bank.family === null) {
      standalone.push(bank)
    } else {
      const members = byFamily.get(bank.family.slug) ?? []
      members.push(bank)
      byFamily.set(bank.family.slug, members)
    }
  }

  const items: PickerItem[] = []
  for (const [slug, members] of byFamily) {
    if (members.length >= 2) {
      items.push({
        kind: 'family',
        key: `family:${slug}`,
        slug,
        // Every member carries the same family; take the label from the first.
        label: members[0].family!.label,
        // Members may lack a logo (e.g. a small co-op bank); use the first one that has one.
        icon: members.find((member) => member.icon !== null)?.icon ?? null,
        members,
      })
    } else {
      // A lone "family" is just a normal bank.
      standalone.push(...members)
    }
  }
  for (const bank of standalone) {
    items.push({ kind: 'bank', key: bank.key, label: displayName(t, bank), bank })
  }
  return items.sort((a, b) => a.label.localeCompare(b.label))
}

function bankMatches(
  bank: SupportedBank,
  query: string,
  digits: string,
  ibanBlz: string | null,
): boolean {
  return (
    bank.name.toLowerCase().includes(query) ||
    (/^\d+$/.test(digits) && bank.blzs.some((blz) => blz.startsWith(digits))) ||
    (ibanBlz !== null && bank.blzs.includes(ibanBlz))
  )
}

function filterItems(items: PickerItem[], query: string): PickerItem[] {
  const q = query.trim().toLowerCase()
  // An empty query shows everything — the list is always visible and scrollable.
  if (q === '') return items
  const digits = q.replace(/\s/g, '')
  const ibanBlz = isLikelyIban(query) ? ibanToBlz(query) : null
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true
    // A BLZ/IBAN/name search surfaces the family if any of its members match, so the
    // user can still reach a specific local bank by drilling in.
    return item.kind === 'bank'
      ? bankMatches(item.bank, q, digits, ibanBlz)
      : item.members.some((member) => bankMatches(member, q, digits, ibanBlz))
  })
}

function filterBanks(banks: SupportedBank[], query: string): SupportedBank[] {
  const q = query.trim().toLowerCase()
  if (q === '') return banks
  const digits = q.replace(/\s/g, '')
  const ibanBlz = isLikelyIban(query) ? ibanToBlz(query) : null
  return banks.filter((bank) => bankMatches(bank, q, digits, ibanBlz))
}

function FamilyRow({
  family,
  onOpen,
}: {
  family: Extract<PickerItem, { kind: 'family' }>
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="border-border/40 border-t first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-muted/60 flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors"
      >
        <BankLogo icon={family.icon} name={family.label} seed={family.slug} />
        <span className="flex flex-1 flex-col">
          <span className="truncate text-sm font-medium">{family.label}</span>
          <span className="text-muted-foreground text-xs">
            {t('credentials.familyCount', { count: family.members.length })}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
      </button>
    </li>
  )
}

/** The grey line under a bank's name: its BLZ (the first, with a "+N" hint when the entry
 *  spans several branch BLZs) and its BIC, when known. */
function bankSubtitle(bank: SupportedBank): string | null {
  const parts: string[] = []
  if (bank.blzs.length === 1) parts.push(bank.blzs[0])
  else if (bank.blzs.length > 1) parts.push(`${bank.blzs[0]} +${bank.blzs.length - 1}`)
  if (bank.bic) parts.push(bank.bic)
  return parts.length > 0 ? parts.join(' · ') : null
}

function BankRow({ bank, accountsCount }: { bank: SupportedBank; accountsCount: number | null }) {
  const { t } = useTranslation()
  const name = displayName(t, bank)
  const subtitle = bankSubtitle(bank)
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

/** Back affordance: either a router link (top-level → credentials list) or a button that
 *  pops the family sub-view back to the top-level list. */
function BackLink({ to, onClick }: { to?: string; onClick?: () => void }) {
  const { t } = useTranslation()
  const className = 'text-primary hover:text-primary/80 -ml-1.5 rounded-md p-1.5 transition-colors'
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={t('credentials.back')}
        onClick={onClick}
        className={className}
      >
        <ChevronLeft className="size-5" />
      </button>
    )
  }
  return (
    <Link to={to} aria-label={t('credentials.back')} className={className}>
      <ChevronLeft className="size-5" />
    </Link>
  )
}
