import { InfoHint } from '@/components/ui/info-hint'
import { Label } from '@/components/ui/label'

interface FormFieldProps {
  id: string
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}

export function FormField({ id, label, hint, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={id}
          className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wide"
        >
          {label}
        </Label>
        {hint ? <InfoHint>{hint}</InfoHint> : null}
      </div>
      {children}
    </div>
  )
}
