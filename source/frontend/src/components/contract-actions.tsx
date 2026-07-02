import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function RenameContractButton({
  name,
  onRename,
}: {
  name: string
  onRename: (name: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)

  const canSubmit = value.trim().length > 0 && value.trim() !== name

  const submit = () => {
    if (!canSubmit) return
    setOpen(false)
    toast.promise(onRename(value.trim()), {
      loading: t('common.saving'),
      success: t('contracts.renamed'),
      error: t('errors.unexpected.title'),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setValue(name)
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('contracts.rename')}
          className="text-muted-foreground hover:text-foreground px-1 sm:px-2.5"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[46rem]">
        <DialogHeader>
          <DialogTitle>{t('contracts.rename')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t('common.cancel')}</Button>
            </DialogClose>
            <Button disabled={!canSubmit} onClick={submit}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
