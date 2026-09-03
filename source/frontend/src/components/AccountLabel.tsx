import type { ReactNode } from 'react'
import { BankLogo } from '@/components/BankLogo'
import { WarningDot } from '@/components/warning-dot'
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
  stale?: boolean
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
  stale = false,
}: AccountLabelProps) {
  const seed = bankName?.trim() || accountName
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span className={cn('relative shrink-0', iconClassName)}>
        <BankLogo icon={icon} name={seed} seed={seed} className="size-full" />
        {stale ? <WarningDot className="-top-0.5 -right-0.5" /> : null}
      </span>
      <span className={nameClassName}>{label ?? accountName}</span>
      {trailing}
    </span>
  )
}
