import type { AccountGroupAccountRef, AccountGroupLayout } from '@/lib/accountGroups'
import type { CredentialRead } from '@/lib/auth'
import { buildAccountLookup, type AccountWithBank } from '@/lib/accountDisplayGroups'

export interface AccountGroup {
  key: string
  heading: string | null
  accounts: AccountWithBank[]
}

export function groupAccounts(
  credentials: CredentialRead[],
  layout?: AccountGroupLayout,
): AccountGroup[] {
  const lookup = buildAccountLookup(credentials)

  if (!layout?.groups?.length) {
    return [...credentials]
      .sort((a, b) => (a.bank_name ?? a.bank).localeCompare(b.bank_name ?? b.bank))
      .map((credential) => ({
        key: `cred-${credential.id}`,
        heading: null,
        accounts: [...credential.accounts]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((account) => lookup.get(account.id)!),
      }))
      .filter((group) => group.accounts.length > 0)
  }

  const resolve = (refs: AccountGroupAccountRef[]) =>
    refs.map((ref) => lookup.get(ref.id)).filter((account): account is AccountWithBank => !!account)

  const groups: AccountGroup[] = layout.groups.map((group) => ({
    key: `group-${group.id}`,
    heading: group.name,
    accounts: resolve(group.accounts),
  }))

  const ungroupedRefs = resolve(layout.ungrouped ?? [])
  const referenced = new Set(
    [...groups.flatMap((group) => group.accounts), ...ungroupedRefs].map((account) => account.id),
  )
  const ungrouped = [
    ...ungroupedRefs,
    ...[...lookup.values()].filter((account) => !referenced.has(account.id)),
  ]
  if (ungrouped.length > 0) {
    groups.push({ key: 'ungrouped', heading: '__ungrouped__', accounts: ungrouped })
  }
  return groups.filter((group) => group.accounts.length > 0)
}

export const accountOptionRowClass =
  'hover:bg-muted/60 focus-visible:bg-muted/60 has-focus-visible:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm outline-none'
