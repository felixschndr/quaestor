import {
  ArrowLeftRight,
  Armchair,
  Banknote,
  Briefcase,
  Bubbles,
  CircleHelp,
  Dumbbell,
  Fuel,
  Gift,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  LineChart,
  Package,
  Percent,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Repeat,
  Shirt,
  ShoppingCart,
  Ticket,
  Undo2,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { TRANSACTION_CATEGORIES, type TransactionCategory } from '@/lib/transaction'
import type { SingleSelectOption } from '@/components/ui/single-select-popover'

export const CATEGORY_ICONS: Record<TransactionCategory, LucideIcon> = {
  SALARY: Wallet,
  ALLOWANCE: HandCoins,
  PENSION: Armchair,
  SIDE_INCOME: Briefcase,
  REIMBURSEMENT: Undo2,
  INTEREST: Percent,
  INVESTMENT: LineChart,
  SUBSCRIPTIONS: Repeat,
  RENT: House,
  UTILITIES: Plug,
  TRAVEL: Plane,
  FUEL: Fuel,
  FITNESS: Dumbbell,
  ONLINE_SHOPPING: Package,
  SUPERMARKET: ShoppingCart,
  DRUGSTORE: Bubbles,
  RESTAURANTS: UtensilsCrossed,
  PERSONAL_CARE: HeartPulse,
  CLOTHING: Shirt,
  GIFTS: Gift,
  ENTERTAINMENT: Ticket,
  FEES: Receipt,
  SAVINGS: PiggyBank,
  WITHDRAWAL: Banknote,
  DEPOSIT: Landmark,
  TRANSFER: ArrowLeftRight,
  UNKNOWN: CircleHelp,
}

const TONES = {
  income: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  finance: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  home: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  mobility: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  shopping: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  body: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  leisure: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  cash: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  none: 'bg-muted text-muted-foreground',
} as const

export const CATEGORY_TONES: Record<TransactionCategory, keyof typeof TONES> = {
  SALARY: 'income',
  ALLOWANCE: 'income',
  PENSION: 'income',
  SIDE_INCOME: 'income',
  REIMBURSEMENT: 'income',
  INTEREST: 'finance',
  INVESTMENT: 'finance',
  SAVINGS: 'finance',
  RENT: 'home',
  UTILITIES: 'home',
  SUBSCRIPTIONS: 'home',
  FEES: 'home',
  TRAVEL: 'mobility',
  FUEL: 'mobility',
  ONLINE_SHOPPING: 'shopping',
  SUPERMARKET: 'shopping',
  DRUGSTORE: 'shopping',
  CLOTHING: 'shopping',
  FITNESS: 'body',
  PERSONAL_CARE: 'body',
  RESTAURANTS: 'leisure',
  ENTERTAINMENT: 'leisure',
  GIFTS: 'leisure',
  WITHDRAWAL: 'cash',
  DEPOSIT: 'cash',
  TRANSFER: 'cash',
  UNKNOWN: 'none',
}

export function useCategoryOptions(): SingleSelectOption<TransactionCategory>[] {
  const { t, i18n } = useTranslation()
  return useMemo(() => {
    const localised = TRANSACTION_CATEGORIES.filter((option) => option !== 'UNKNOWN').map(
      (option) => ({
        value: option,
        label: t(`category.${option}`),
        leading: <CategoryAvatar category={option} className="size-5" iconClassName="size-3" />,
      }),
    )
    localised.sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    return [
      ...localised,
      {
        value: 'UNKNOWN' as TransactionCategory,
        label: t('category.UNKNOWN'),
        leading: <CategoryAvatar category="UNKNOWN" className="size-5" iconClassName="size-3" />,
      },
    ]
  }, [t, i18n.language])
}

export function CategoryAvatar({
  category,
  className,
  iconClassName,
}: {
  category: string
  className?: string
  iconClassName?: string
}) {
  const Icon = CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] ?? CircleHelp
  const tone = TONES[CATEGORY_TONES[category as TransactionCategory] ?? 'none']
  return (
    <span
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full',
        tone,
        className,
      )}
    >
      <Icon className={cn('size-7', iconClassName)} aria-hidden="true" />
    </span>
  )
}
