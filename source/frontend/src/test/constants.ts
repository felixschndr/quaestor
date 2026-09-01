import { formatMoney } from '@/lib/format'

// Rendered euro text for assertions, derived from an amount so it tracks the constant.
export const money = (amount: number): string => formatMoney(amount).replace(/\u00a0/g, ' ')

export const TEST_IBAN = 'DE12345678900001'
export const TEST_IBAN_FORMATTED = 'DE12 3456 7890 0001'
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

export const DEVICE_CODE = 'ABCD-EFGH'
export const SECOND_DEVICE_CODE = 'WXYZ-1234'
export const AUTHORIZATION_URL = 'https://secure.scalable.capital/activate'
export const AUTHORIZATION_URL_WITH_CODE = `${AUTHORIZATION_URL}?user_code=${DEVICE_CODE}`

export const ACCOUNT_NAME_CHECKING = 'Gehaltskonto'
export const ACCOUNT_NAME_SAVINGS = 'Sparkonto'
export const ACCOUNT_NAME_GIRO = 'Girokonto'
export const ACCOUNT_NAME_DAY = 'Tagesgeld'
export const ACCOUNT_NAME_BROKER = 'TR Cash'
export const GROUP_NAME_SAVINGS = 'Spar'

export const PARTY_SUPERMARKET = 'Rewe'

export const LABEL_SALARY = 'Salary'
export const LABEL_SAVINGS = 'Savings'
export const LABEL_GROCERIES = 'Groceries'
export const LABEL_RENT = 'Rent'

export const TEST_BALANCE = 1234.5

export const AMOUNT_S = 10
export const AMOUNT_M = 50
export const AMOUNT_L = 100
export const AMOUNT_XL = 1500

export const DATE_TODAY = '2026-05-22'
export const DATE_YESTERDAY = '2026-05-21'
export const DATE_RECENT = '2026-05-20'
export const DATE_MID_MONTH = '2026-05-15'
export const DATE_YEAR_START = '2026-01-01'

export const DATETIME_RECENT = '2026-05-20T10:00:00Z'
export const DATETIME_UPDATED = '2026-06-15T08:30:00Z'

export const TODAY = new Date(2026, 4, 22) // Date form of DATE_TODAY
export const TODAY_RECURRING = new Date(2026, 6, 1) // "today" for recurring-schedule tests

export const DATE_OLDER = '2026-05-10'
export const DATE_NEXT_RUN = '2026-07-15'
export const DATE_BROKER_SETTLE = '2026-07-16'
export const DATE_SAME_DAY_TRANSFER = '2026-08-11'
export const DATE_RANGE_END = '2026-01-10'
export const DATE_FAR_FUTURE = '2099-01-15'
export const DATE_LONG_OVERDUE = '2020-01-01'
export const DATETIME_FAR_FUTURE = '2099-01-01T00:00:00Z'
export const DATETIME_CREATED_NEWER = '2026-05-21T10:00:00Z'
