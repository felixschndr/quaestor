import {
  ArrowLeftRight,
  Armchair,
  Baby,
  Backpack,
  Banknote,
  Bike,
  Briefcase,
  Bubbles,
  Candy,
  Car,
  CarTaxiFront,
  CircleHelp,
  CircleParking,
  Cloud,
  Coins,
  CreditCard,
  Dumbbell,
  Flame,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Hammer,
  HandCoins,
  HeartHandshake,
  HeartPulse,
  House,
  KeyRound,
  Landmark,
  Laptop,
  LineChart,
  Package,
  PartyPopper,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Radio,
  Receipt,
  ReceiptText,
  Scale,
  Scissors,
  Shapes,
  Shield,
  ShieldCheck,
  ShieldPlus,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sofa,
  Stethoscope,
  Syringe,
  Tag,
  Ticket,
  TrainFront,
  TrendingUp,
  Tv,
  Undo2,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { useCategoryCatalog } from '@/lib/categoryCatalog'
import {
  CATEGORY_GROUPS,
  type CategoryGroup,
  type CategoryKey,
  type TransactionCategory,
} from '@/lib/transaction'
import type { SingleSelectOption } from '@/components/ui/single-select-popover'

export const CATEGORY_ICONS: Record<TransactionCategory | CategoryGroup, LucideIcon> = {
  INCOME: TrendingUp,
  SALARY: Wallet,
  SIDE_INCOME: Briefcase,
  PENSION: Armchair,
  ALLOWANCE: HandCoins,
  PUBLIC_BENEFITS: Landmark,
  RENTAL_INCOME: KeyRound,
  INTEREST: Percent,
  PRIVATE_SALES: Tag,
  REIMBURSEMENT: Undo2,
  OTHER_INCOME: Coins,

  FOOD_AND_DRINK: UtensilsCrossed,
  SUPERMARKET: ShoppingCart,
  RESTAURANTS: UtensilsCrossed,
  FOOD_DELIVERY: Pizza,

  HOUSING: House,
  RENT: House,
  ELECTRICITY: Zap,
  HEATING: Flame,
  INTERNET_PHONE: Wifi,
  BROADCASTING_FEE: Radio,
  FURNISHING: Sofa,
  OTHER_HOUSING: Hammer,

  MOBILITY: Car,
  FUEL: Fuel,
  PUBLIC_TRANSPORT: TrainFront,
  CAR: Car,
  PARKING: CircleParking,
  SHARING_TAXI: CarTaxiFront,
  OTHER_MOBILITY: Bike,

  LEISURE: Ticket,
  VACATION: Plane,
  FITNESS: Dumbbell,
  EVENTS: Ticket,
  STREAMING: Tv,
  GAMING: Gamepad2,
  ENTERTAINMENT: PartyPopper,

  SHOPPING: ShoppingBag,
  ONLINE_SHOPPING: Package,
  CLOTHING: Shirt,
  ELECTRONICS: Laptop,
  SOFTWARE_CLOUD: Cloud,
  GIFTS: Gift,

  HEALTH: HeartPulse,
  DRUGSTORE: Bubbles,
  PHARMACY: Pill,
  DOCTOR: Stethoscope,
  PERSONAL_CARE: Scissors,

  INSURANCE: ShieldCheck,
  HEALTH_INSURANCE: ShieldPlus,
  OTHER_INSURANCE: Shield,

  FINANCES: Landmark,
  BANK_FEES: Receipt,
  TAXES: Landmark,
  LEGAL: Scale,
  EDUCATION: GraduationCap,
  DONATION: HeartHandshake,
  FEES: ReceiptText,

  SAVINGS_AND_INVESTMENTS: PiggyBank,
  SAVINGS: PiggyBank,
  INVESTMENT: LineChart,

  CHILDREN: Baby,
  CHILDCARE: Baby,
  POCKET_MONEY: Candy,
  OTHER_CHILDREN: Backpack,

  PETS: PawPrint,
  PET_SUPPLIES: PawPrint,
  VET: Syringe,

  MISCELLANEOUS: Shapes,
  WITHDRAWAL: Banknote,
  DEPOSIT: Landmark,
  TRANSFER: ArrowLeftRight,
  CREDIT_CARD_SETTLEMENT: CreditCard,

  UNKNOWN: CircleHelp,
}

const TONES = {
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  orange: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  fuchsia: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  slate: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  teal: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  cyan: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  pink: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  lime: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  none: 'bg-muted text-muted-foreground',
} as const

// A category is tinted by its group
export const GROUP_TONES: Record<CategoryGroup, keyof typeof TONES> = {
  INCOME: 'emerald',
  FOOD_AND_DRINK: 'orange',
  HOUSING: 'amber',
  MOBILITY: 'sky',
  LEISURE: 'fuchsia',
  SHOPPING: 'violet',
  HEALTH: 'rose',
  INSURANCE: 'slate',
  FINANCES: 'teal',
  SAVINGS_AND_INVESTMENTS: 'cyan',
  CHILDREN: 'pink',
  PETS: 'lime',
  MISCELLANEOUS: 'blue',
}

// Grouped in display order with the user's own custom categories after the fixed ones, UNKNOWN last. Custom categories
// are left out where only the fixed ones may be assigned (a transaction on an account shared with the user).
export function useCategoryOptions({
  includeCustom = true,
}: { includeCustom?: boolean } = {}): SingleSelectOption<CategoryKey>[] {
  const { t } = useTranslation()
  const catalog = useCategoryCatalog()
  return useMemo(() => {
    const option = (category: CategoryKey, group?: string) => ({
      value: category,
      label: catalog.label(category),
      group,
      leading: <CategoryAvatar category={category} className="size-5" iconClassName="size-3" />,
    })
    return [
      ...CATEGORY_GROUPS.flatMap((group) =>
        catalog
          .categoriesOf(group, includeCustom)
          .map((category) => option(category, t(`common.transactionLabel.${group}`))),
      ),
      option('UNKNOWN'),
    ]
  }, [t, catalog, includeCustom])
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
  const group = useCategoryCatalog().groupOf(category)
  // A custom category shows the icon of its group
  const Icon =
    CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] ??
    (group ? CATEGORY_ICONS[group] : CircleHelp)
  return (
    <span
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full',
        TONES[group ? GROUP_TONES[group] : 'none'],
        className,
      )}
    >
      <Icon className={cn('size-7', iconClassName)} aria-hidden="true" />
    </span>
  )
}
