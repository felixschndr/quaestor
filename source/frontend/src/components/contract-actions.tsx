import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function RenameContractButton({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t('contracts.rename')}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground px-1 sm:px-2.5"
    >
      <Pencil className="size-3.5" aria-hidden="true" />
    </Button>
  )
}

export function ContractNameInput({
  name,
  onRename,
  onDone,
}: {
  name: string
  onRename: (name: string) => Promise<unknown>
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const canSubmit = value.trim().length > 0 && value.trim() !== name

  const submit = () => {
    if (!canSubmit) {
      onDone()
      return
    }
    onDone()
    toast.promise(onRename(value.trim()), {
      loading: t('common.saving'),
      success: t('contracts.renamed'),
      error: t('errors.unexpected.title'),
    })
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        ref={inputRef}
        value={value}
        aria-label={t('contracts.rename')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          else if (event.key === 'Escape') onDone()
        }}
        className="h-9 text-xl font-semibold"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t('common.save')}
        disabled={!canSubmit}
        onClick={submit}
        className="text-muted-foreground hover:text-success px-1 sm:px-2.5"
      >
        <Check className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t('common.cancel')}
        onClick={onDone}
        className="text-muted-foreground hover:text-foreground px-1 sm:px-2.5"
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

export function DeleteContractButton({
  onConfirm,
  isDeleting,
}: {
  onConfirm: () => void
  isDeleting?: boolean
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex gap-1">
        <Button size="sm" variant="destructive" onClick={onConfirm} disabled={isDeleting}>
          {t('contracts.deleteConfirm')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={isDeleting}
        >
          {t('common.cancel')}
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t('contracts.delete')}
      onClick={() => setConfirming(true)}
      className="text-muted-foreground hover:text-destructive px-1 sm:px-2.5"
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
    </Button>
  )
}
