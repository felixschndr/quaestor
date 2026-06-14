import type { AccountRead, UserRead } from './auth'
import type { AccountGroupAccountRef, AccountGroupLayout } from './accountGroups'

export interface AccountWithBank extends AccountRead {
  bank: string
  bankName: string | null
  bankIcon: string | null
}

export interface DisplayGroup {
  key: string
  heading: string | null
  accounts: AccountWithBank[]
}

export function buildAccountLookup(user: UserRead): Map<number, AccountWithBank> {
  const map = new Map<number, AccountWithBank>()
  for (const credential of user.credentials) {
    for (const account of credential.accounts) {
      map.set(account.id, {
        ...account,
        bank: credential.bank,
        bankName: credential.bank_name,
        bankIcon: credential.bank_icon,
      })
    }
  }
  return map
}

export function buildDisplayGroups(
  user: UserRead,
  layout: AccountGroupLayout | undefined,
): DisplayGroup[] {
  const usesCustomLayout = !!layout && layout.groups.length > 0
  if (!usesCustomLayout) {
    return [...user.credentials]
      .sort((a, b) => (a.bank_name ?? a.bank).localeCompare(b.bank_name ?? b.bank))
      .map((credential) => ({
        key: `cred-${credential.id}`,
        heading: null,
        accounts: credential.accounts
          .filter((account) => !account.is_hidden)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((account) => ({
            ...account,
            bank: credential.bank,
            bankName: credential.bank_name,
            bankIcon: credential.bank_icon,
          })),
      }))
      .filter((group) => group.accounts.length > 0)
  }
  const lookup = buildAccountLookup(user)
  const resolveAccounts = (refs: AccountGroupAccountRef[]) =>
    refs
      .map((ref) => lookup.get(ref.id))
      .filter((account): account is AccountWithBank => !!account && !account.is_hidden)

  const groups: DisplayGroup[] = layout!.groups.map((group) => ({
    key: `group-${group.id}`,
    heading: group.name,
    accounts: resolveAccounts(group.accounts),
  }))
  const ungroupedAccounts = resolveAccounts(layout!.ungrouped)
  if (ungroupedAccounts.length > 0) {
    groups.push({ key: 'ungrouped', heading: '__ungrouped__', accounts: ungroupedAccounts })
  }
  return groups
}

export function sumFactoredBalance(
  accounts: { balance: number; balance_factor: number }[],
): number {
  return accounts.reduce(
    (sum, account) => sum + (account.balance * account.balance_factor) / 100,
    0,
  )
}
