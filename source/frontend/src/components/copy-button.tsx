import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

export interface CopyButtonProps {
  value: string
  label: string
  successMessage?: string
  errorMessage?: string
  className?: string
}

export function CopyButton({
  value,
  label,
  successMessage,
  errorMessage,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(resetTimeout.current), [])

  const handleCopy = async () => {
    try {
      await copyText(value)
      setCopied(true)
      clearTimeout(resetTimeout.current)
      resetTimeout.current = setTimeout(() => setCopied(false), 2000)
      if (successMessage) toast.success(successMessage)
    } catch {
      if (errorMessage) toast.error(errorMessage)
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
      {copied ? (
        <Check className="text-success size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  )
}
