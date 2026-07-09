import { useEffect, useRef, useState } from 'react'
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
  negative,
  onNegativeChange,
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
  // Controlled sign: pass `negative` (plus `onNegativeChange`) to let a parent
  // link the sign across several inputs — e.g. a from/to range that flips both
  // signs together. When omitted, the toggle manages its own sign internally.
  negative?: boolean
  onNegativeChange?: (next: boolean) => void
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
  const [internalNegative, setInternalNegative] = useState<boolean>(initialNegative)
  const controlled = negative !== undefined
  const isNegative = controlled ? negative : internalNegative

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

  // When the controlled sign changes from the outside (a linked input was
  // toggled), re-sign this field's current magnitude so its value follows.
  const prevNegative = useRef(negative)
  useEffect(() => {
    if (!controlled || prevNegative.current === negative) return
    prevNegative.current = negative
    emit(magnitude, negative)
    // Only react to sign changes; magnitude edits emit through onChange already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negative])

  const toggleSign = () => {
    const next = !isNegative
    if (controlled) {
      onNegativeChange?.(next)
    } else {
      setInternalNegative(next)
      emit(magnitude, next)
    }
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <button
        type="button"
        aria-label={isNegative ? t('search.amountMakePositive') : t('search.amountMakeNegative')}
        aria-pressed={isNegative}
        disabled={disabled}
        onClick={toggleSign}
        className={cn(
          'border-input flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-transparent text-sm font-medium transition-colors',
          'hover:border-ring focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
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
