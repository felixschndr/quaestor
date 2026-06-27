import { Label } from '@/components/ui/label'

interface FormFieldProps {
  id: string
  label: string
  /** Rendered inline next to the label (e.g. an info popover trigger). */
  labelHint?: React.ReactNode
  /** Rendered as a muted description below the field. */
  hint?: React.ReactNode
  children: React.ReactNode
}

/**
 * Label + control grouping shared by the transaction forms. `labelHint` sits inline
 * with the label; `hint` renders as a description line below the control.
 */
export function FormField({ id, label, labelHint, hint, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Label
          htmlFor={id}
          className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
        >
          {label}
        </Label>
        {labelHint}
      </div>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
