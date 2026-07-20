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

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
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
  const Icon = CATEGORY_ICONS[category] ?? CircleHelp
  return (
    <span
      className={cn(
        'bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-full',
        className,
      )}
    >
      <Icon className={cn('size-7', iconClassName)} aria-hidden="true" />
    </span>
  )
}
