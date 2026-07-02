import type { AccountRead, CredentialRead } from '@/lib/auth'

export interface AccountGroup {
  key: string
  name: string
  icon: string | null
  accounts: AccountRead[]
}

/** Group accounts by bank connection, sorted like the overview, dropping empty banks. */
export function groupAccountsByBank(credentials: CredentialRead[]): AccountGroup[] {
  // Group by credential (one bank connection) — generic FinTS banks share provider "fints",
  // so grouping by provider would merge different banks and pick the wrong/missing logo.
  return [...credentials]
    .sort((a, b) => (a.bank_name ?? a.bank).localeCompare(b.bank_name ?? b.bank))
    .map((credential) => ({
      key: `cred-${credential.id}`,
      name: credential.bank_name ?? credential.bank,
      icon: credential.bank_icon,
      accounts: [...credential.accounts].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.accounts.length > 0)
}

export const accountOptionRowClass =
  'hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm'
