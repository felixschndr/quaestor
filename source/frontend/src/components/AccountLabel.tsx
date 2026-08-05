import type { ReactNode } from 'react'
import { BankLogo } from '@/components/BankLogo'
import { cn } from '@/lib/utils'

export interface AccountLabelProps {
  icon: string | null
  bankName?: string | null
  accountName: string
  label?: ReactNode
  iconClassName?: string
  nameClassName?: string
  className?: string
  trailing?: ReactNode
}

export function AccountLabel({
  icon,
  bankName,
  accountName,
  label,
  iconClassName = 'size-5',
  nameClassName = 'truncate text-sm',
  className,
  trailing,
}: AccountLabelProps) {
  const seed = bankName?.trim() || accountName
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <BankLogo icon={icon} name={seed} seed={seed} className={cn('shrink-0', iconClassName)} />
      <span className={nameClassName}>{label ?? accountName}</span>
      {trailing}
    </span>
  )
}
