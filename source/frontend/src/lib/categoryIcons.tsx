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

import { cn } from '@/lib/utils'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
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
