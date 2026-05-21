import type { AccountRead, CredentialRead } from './auth'

export interface BankGroup {
  bank: string
  accounts: AccountRead[]
}

/**
 * Group accounts across all credentials by their bank, sorted alphabetically
 * by bank name; within each group, accounts are sorted alphabetically by name.
 *
 * A user can have multiple credentials for the same bank (e.g. two ING
 * logins), so accounts from different credentials are merged into one group.
 */
export function groupAccountsByBank(credentials: CredentialRead[]): BankGroup[] {
  const byBank = new Map<string, AccountRead[]>()
  for (const credential of credentials) {
    const list = byBank.get(credential.bank) ?? []
    for (const account of credential.accounts) list.push(account)
    byBank.set(credential.bank, list)
  }
  return Array.from(byBank.entries())
    .map(([bank, accounts]) => ({
      bank,
      accounts: [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.bank.localeCompare(b.bank))
}

export function bankIconUrl(bank: string): string {
  return `/static/banks/${bank}.png`
}

export function displayNameOrUserName(user: { display_name: string; user_name: string }): string {
  return user.display_name.trim() || user.user_name
}
