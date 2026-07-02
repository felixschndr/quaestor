import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedToggleProps<T extends string> {
  /** `null` renders with no segment highlighted — used when the parent state
   *  doesn't (yet) correspond to any option (e.g. a custom date range). */
  value: T | null
  options: SegmentedOption<T>[]
  onChange: (next: T) => void
  ariaLabel: string
  /** Full-width control: bordered track like the form inputs (h-8, text-sm),
   *  each button taking an equal share of the width. Default is the compact
   *  pill used as an inline chart-header control. */
  fullWidth?: boolean
}

/**
 * Segmented control used for the chart-type (bar/pie) and direction
 * (expense/income) switches. Fully controlled by the parent.
 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fullWidth = false,
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'flex gap-0.5 rounded-lg p-0.5',
        fullWidth ? 'border-input h-8 w-full border bg-transparent dark:bg-input/30' : 'bg-muted',
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'cursor-pointer rounded-md font-medium transition-colors',
              fullWidth ? 'flex-1 text-sm' : 'px-2.5 py-1 text-xs',
              selected
                ? fullWidth
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
