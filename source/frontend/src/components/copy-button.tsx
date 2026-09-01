import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { COPY_FEEDBACK_MS, useCopyFeedback } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

export interface CopyButtonProps {
  value: string
  label: string
  className?: string
  successMessage?: string
}

export function CopyButton({ value, label, className, successMessage }: CopyButtonProps) {
  const { copied, copy } = useCopyFeedback()

  const handleCopy = async () => {
    if ((await copy(value)) && successMessage) {
      toast.success(successMessage, { duration: COPY_FEEDBACK_MS })
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className={cn(
        'hover:text-foreground cursor-pointer rounded p-0.5 transition-colors',
        className,
      )}
    >
      <span className="relative inline-flex size-3.5 items-center justify-center">
        <Copy
          className={cn(
            'absolute size-3.5 transition-all duration-200',
            copied ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100',
          )}
          aria-hidden="true"
        />
        <Check
          className={cn(
            'text-success absolute size-3.5 transition-all duration-200',
            copied ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0',
          )}
          aria-hidden="true"
        />
      </span>
    </button>
  )
}
