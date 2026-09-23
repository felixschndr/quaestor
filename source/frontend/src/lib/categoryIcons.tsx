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

export const GROUP_TONES: Record<CategoryGroup, string> = {
  INCOME: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  FOOD_AND_DRINK: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  HOUSING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  MOBILITY: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  LEISURE: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  SHOPPING: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  HEALTH: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  INSURANCE: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  FINANCES: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  SAVINGS_AND_INVESTMENTS: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  CHILDREN: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  PETS: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  MISCELLANEOUS: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
}

const NO_TONE = 'bg-muted text-muted-foreground'

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
  const Icon =
    CATEGORY_ICONS[category as keyof typeof CATEGORY_ICONS] ??
    (group ? CATEGORY_ICONS[group] : CircleHelp)
  return (
    <span
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full',
        group ? GROUP_TONES[group] : NO_TONE,
        className,
      )}
    >
      <Icon className={cn('size-7', iconClassName)} aria-hidden="true" />
    </span>
  )
}
