import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { formatAmountForInput } from '@/lib/format'
import { cn } from '@/lib/utils'

export function AmountInput({
  id,
  value,
  onChange,
  placeholder,
  formatOnBlur = false,
  autoFocus = false,
  disabled = false,
  onKeyDown,
  className,
  inputClassName,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: {
  id: string
  value: number | undefined
  onChange: (next: number | undefined) => void
  placeholder?: string
  formatOnBlur?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  className?: string
  inputClassName?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}) {
  const { t } = useTranslation()
  const initialNegative = value !== undefined && value < 0
  const initialMagnitude =
    value === undefined
      ? ''
      : formatOnBlur
        ? formatAmountForInput(Math.abs(value))
        : String(Math.abs(value))
  const [magnitude, setMagnitude] = useState<string>(initialMagnitude)
  const [isNegative, setIsNegative] = useState<boolean>(initialNegative)

  const parseMagnitude = (raw: string): number | null => {
    const trimmed = raw.trim().replace(',', '.')
    if (trimmed === '' || trimmed === '.') return null
    const parsed = Math.abs(Number(trimmed))
    return Number.isFinite(parsed) ? parsed : null
  }

  const emit = (nextMagnitude: string, nextNegative: boolean) => {
    const parsed = parseMagnitude(nextMagnitude)
    onChange(parsed === null ? undefined : nextNegative ? -parsed : parsed)
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <button
        type="button"
        aria-label={isNegative ? t('search.amountMakePositive') : t('search.amountMakeNegative')}
        aria-pressed={isNegative}
        disabled={disabled}
        onClick={() => {
          const next = !isNegative
          setIsNegative(next)
          emit(magnitude, next)
        }}
        className={cn(
          'border-input flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-transparent text-sm font-medium transition-colors',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          'disabled:pointer-events-none disabled:opacity-50',
          'dark:bg-input/30',
          isNegative ? 'text-destructive' : 'text-success',
        )}
      >
        {isNegative ? '−' : '+'}
      </button>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        value={magnitude}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        className={inputClassName}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          const raw = event.target.value
          setMagnitude(raw)
          emit(raw, isNegative)
        }}
        onBlur={
          formatOnBlur
            ? () => {
                const parsed = parseMagnitude(magnitude)
                if (parsed !== null) setMagnitude(formatAmountForInput(parsed))
              }
            : undefined
        }
      />
    </div>
  )
}
