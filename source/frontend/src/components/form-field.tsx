import { Label } from '@/components/ui/label'

interface FormFieldProps {
  id: string
  label: string
  /** Rendered as a muted description below the field. */
  hint?: React.ReactNode
  children: React.ReactNode
}

export function FormField({ id, label, hint, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
      >
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
