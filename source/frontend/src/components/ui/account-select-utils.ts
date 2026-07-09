import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { AccountRead, CredentialRead } from '@/lib/auth'

export interface AccountGroup {
  key: string
  name: string
  icon: string | null
  accounts: AccountRead[]
}

export function groupAccountsByBank(
  credentials: CredentialRead[],
  layout?: AccountGroupLayout,
): AccountGroup[] {
  const rank = layoutRank(layout)
  const byOverviewPosition = (a: AccountRead, b: AccountRead) =>
    (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name)
  return [...credentials]
    .map((credential) => ({
      key: `cred-${credential.id}`,
      name: credential.bank_name ?? credential.bank,
      icon: credential.bank_icon,
      accounts: [...credential.accounts].sort(byOverviewPosition),
    }))
    .filter((group) => group.accounts.length > 0)
    .sort(
      (a, b) =>
        (rank.get(a.accounts[0].id) ?? Infinity) - (rank.get(b.accounts[0].id) ?? Infinity) ||
        a.name.localeCompare(b.name),
    )
}

function layoutRank(layout: AccountGroupLayout | undefined): Map<number, number> {
  const rank = new Map<number, number>()
  if (!layout?.groups?.length) return rank
  const refs = [...layout.groups.flatMap((group) => group.accounts), ...(layout.ungrouped ?? [])]
  refs.forEach((ref, index) => rank.set(ref.id, index))
  return rank
}

export const accountOptionRowClass =
  'hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm'
