import type { ReactNode } from 'react'

export function SelectAllHeader({
  countLabel,
  allLabel,
  noneLabel,
  onAll,
  onNone,
  defaultLabel,
  onDefault,
}: {
  countLabel: ReactNode
  allLabel: ReactNode
  noneLabel: ReactNode
  onAll: () => void
  onNone: () => void
  defaultLabel?: ReactNode
  onDefault?: () => void
}) {
  const buttonClass =
    'text-primary hover:text-primary/80 cursor-pointer rounded-md px-2 py-0.5 transition-colors'
  return (
    <div className="border-border/40 flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
      <span className="text-muted-foreground">{countLabel}</span>
      <div className="flex gap-1">
        <button type="button" className={buttonClass} onClick={onAll}>
          {allLabel}
        </button>
        {onDefault && (
          <button type="button" className={buttonClass} onClick={onDefault}>
            {defaultLabel}
          </button>
        )}
        <button type="button" className={buttonClass} onClick={onNone}>
          {noneLabel}
        </button>
      </div>
    </div>
  )
}
