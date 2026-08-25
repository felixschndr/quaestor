import { useTranslation } from 'react-i18next'

import type { RefundStatus } from '@/lib/accountHistory'

const LABEL_KEY: Record<RefundStatus, string> = {
  refunded: 'transaction.refundedBadge',
  partially_refunded: 'transaction.partiallyRefundedBadge',
  refund: 'transaction.refundBadge',
}

export function RefundBadge({ status }: { status: RefundStatus | null | undefined }) {
  const { t } = useTranslation()
  if (!status) return null
  return (
    <span className="bg-success/10 text-success shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
      {t(LABEL_KEY[status])}
    </span>
  )
}
