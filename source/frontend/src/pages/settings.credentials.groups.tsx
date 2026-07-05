import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, GripVertical, Pencil, Plus, X } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  usePutAccountGroupLayout,
  type AccountGroupLayout,
  type AccountGroupLayoutWrite,
} from '@/lib/accountGroups'
import { accountDisplayName, useUpdateAccount } from '@/lib/accounts'
import { BankLogo } from '@/components/BankLogo'
import { cn } from '@/lib/utils'
import type { AccountRead, UserRead } from '@/lib/auth'

// Stable id namespaces so dnd-kit can tell account items, account drop
// containers, and sortable group sections apart in a single DndContext.
//   account-<id>    — a draggable account row
//   container-<id>  — the drop area inside a group (or "ungrouped")
//   group-<id>      — a sortable group section (drag handle in its header)
const UNGROUPED_ID = 'ungrouped'
const accountItemId = (accountId: number): string => `account-${accountId}`
const accountIdFromItemId = (itemId: string): number => Number(itemId.replace('account-', ''))
const groupContainerId = (groupId: number | typeof UNGROUPED_ID): string => `container-${groupId}`
const groupSortableId = (groupId: number): string => `group-${groupId}`
const groupIdFromSortableId = (sortableId: string): number =>
  Number(sortableId.replace('group-', ''))

interface AccountWithBank extends AccountRead {
  bank: string
  bankName: string | null
  bankIcon: string | null
}

type AccountLookup = Map<number, AccountWithBank>

export function buildAccountLookup(user: UserRead | undefined): AccountLookup {
  const map: AccountLookup = new Map()
  if (!user) return map
  for (const credential of user.credentials) {
    for (const account of credential.accounts) {
      map.set(account.id, {
        ...account,
        bank: credential.bank,
        bankName: credential.bank_name,
        bankIcon: credential.bank_icon,
      })
    }
  }
  return map
}

export interface GroupsEditorViewProps {
  layout: AccountGroupLayout
  accountLookup: AccountLookup
}

export function GroupsEditorView({ layout, accountLookup }: GroupsEditorViewProps) {
  const { t } = useTranslation()
  // The local copy lets us reorder optimistically during drag without waiting
  // for the server round-trip; once a PUT lands and updates the cached prop,
  // we adopt the new server truth (including assigned ids for new groups).
  const [localLayout, setLocalLayout] = useState<AccountGroupLayout>(layout)
  const [lastServerLayout, setLastServerLayout] = useState<AccountGroupLayout>(layout)
  if (layout !== lastServerLayout) {
    // Prop changed — drop any in-flight local-only edits and re-sync.
    // (Storing-previous-render pattern: setState during render is the
    // recommended way to keep state in sync with props.)
    setLastServerLayout(layout)
    setLocalLayout(layout)
  }

  const { mutateAsync, isPending } = usePutAccountGroupLayout()

  // Debounced auto-save on layout changes (drag, rename, delete, create).
  useEffect(() => {
    if (sameLayout(localLayout, lastServerLayout)) return
    const payload = toWritePayload(localLayout)
    const handle = setTimeout(() => {
      mutateAsync(payload).then(
        () => toast.success(t('credentials.groups.saved')),
        () => toast.error(t('credentials.groups.saveFailed')),
      )
    }, 400)
    return () => clearTimeout(handle)
  }, [localLayout, lastServerLayout, mutateAsync, t])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  // Cross-container moves for accounts must happen on dragOver, not just dragEnd
  // — otherwise dnd-kit can't animate space being made in the target container,
  // so the hovered group looks unchanged until release. Within the same
  // container we leave the layout alone and let SortableContext handle the
  // visual swap via transforms. Group reordering is handled in dragEnd via
  // arrayMove, which already matches what SortableContext renders during drag.
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeRaw = String(active.id)
    if (!activeRaw.startsWith('account-')) return
    const accountId = accountIdFromItemId(activeRaw)
    const overId = String(over.id)
    const insertAfter = shouldInsertAfter(active, over)
    setLocalLayout((current) => {
      const from = parseTargetContainer(`account-${accountId}`, current)
      const to = parseTargetContainer(overId, current)
      if (from === null || to === null || from === to) return current
      return moveAccount(current, accountId, overId, insertAfter)
    })
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const activeRaw = String(active.id)
    const overRaw = String(over.id)
    if (activeRaw.startsWith('group-')) {
      if (!overRaw.startsWith('group-')) return
      const fromGroupId = groupIdFromSortableId(activeRaw)
      const toGroupId = groupIdFromSortableId(overRaw)
      setLocalLayout((current) => moveGroup(current, fromGroupId, toGroupId))
      return
    }
    const accountId = accountIdFromItemId(activeRaw)
    const insertAfter = shouldInsertAfter(active, over)
    setLocalLayout((current) => moveAccount(current, accountId, overRaw, insertAfter))
  }, [])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
  }, [])

  // Filter droppables by drag kind so account drags only see account drop zones
  // and group drags only see other groups. Without this, closestCenter could
  // match a group section while dragging an account (the section is droppable
  // because it's sortable), breaking parseTargetContainer.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const isGroupDrag = String(args.active.id).startsWith('group-')
    const droppableContainers = args.droppableContainers.filter((container) => {
      const id = String(container.id)
      return isGroupDrag ? id.startsWith('group-') : !id.startsWith('group-')
    })
    return closestCenter({ ...args, droppableContainers })
  }, [])

  const activeAccount =
    activeId?.startsWith('account-') && accountLookup.has(accountIdFromItemId(activeId))
      ? accountLookup.get(accountIdFromItemId(activeId))!
      : null

  const handleCreateGroup = () => {
    const name = t('credentials.groups.newGroupName')
    setLocalLayout((current) => ({
      ...current,
      groups: [
        ...current.groups,
        // Placeholder negative id so the editor can show + reorder it before
        // the server assigns a real id. The PUT payload omits these ids.
        { id: -Date.now(), name, accounts: [] },
      ],
    }))
  }

  const handleRenameGroup = (groupId: number, newName: string) => {
    setLocalLayout((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId ? { ...group, name: newName } : group,
      ),
    }))
  }

  const handleDeleteGroup = (groupId: number) => {
    setLocalLayout((current) => {
      const target = current.groups.find((group) => group.id === groupId)
      if (!target) return current
      return {
        groups: current.groups.filter((group) => group.id !== groupId),
        ungrouped: [...current.ungrouped, ...target.accounts],
      }
    })
  }

  const accountCount = Array.from(accountLookup.values()).length
  if (accountCount === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{t('credentials.groups.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">{t('credentials.groups.description')}</p>
        {isPending ? (
          <span className="text-muted-foreground text-xs">{t('credentials.groups.saving')}</span>
        ) : null}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleCreateGroup}
        className="self-start"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t('credentials.groups.create')}
      </Button>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-col gap-3">
          <SortableContext
            items={localLayout.groups.map((g) => groupSortableId(g.id))}
            strategy={verticalListSortingStrategy}
          >
            {localLayout.groups.map((group) => (
              <GroupContainer
                key={group.id}
                group={group}
                accountLookup={accountLookup}
                onRename={(name) => handleRenameGroup(group.id, name)}
                onDelete={() => handleDeleteGroup(group.id)}
              />
            ))}
          </SortableContext>
          <UngroupedContainer accounts={localLayout.ungrouped} accountLookup={accountLookup} />
        </div>
        <DragOverlay>
          {activeAccount ? <AccountItemView account={activeAccount} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function GroupContainer({
  group,
  accountLookup,
  onRename,
  onDelete,
}: {
  group: { id: number; name: string; accounts: { id: number }[] }
  accountLookup: AccountLookup
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const containerId = groupContainerId(group.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupSortableId(group.id),
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <section
      ref={setNodeRef}
      style={style}
      className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none active:cursor-grabbing"
          aria-label={t('credentials.groups.reorder')}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <Input
          aria-label={t('credentials.groups.nameLabel')}
          value={group.name}
          onChange={(event) => onRename(event.target.value)}
          maxLength={150}
          className="h-7 flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={t('credentials.groups.delete')}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>
      <DroppableArea
        containerId={containerId}
        accountIds={group.accounts.map((a) => a.id)}
        accountLookup={accountLookup}
        emptyHint={t('credentials.groups.dropHint')}
      />
    </section>
  )
}

function UngroupedContainer({
  accounts,
  accountLookup,
}: {
  accounts: { id: number }[]
  accountLookup: AccountLookup
}) {
  const { t } = useTranslation()
  return (
    <section className="border-border/60 flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <header className="flex items-center gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          {t('credentials.groups.ungroupedHeading')}
        </h2>
      </header>
      <DroppableArea
        containerId={groupContainerId(UNGROUPED_ID)}
        accountIds={accounts.map((a) => a.id)}
        accountLookup={accountLookup}
        emptyHint={t('credentials.groups.ungroupedEmpty')}
      />
    </section>
  )
}

function DroppableArea({
  containerId,
  accountIds,
  accountLookup,
  emptyHint,
}: {
  containerId: string
  accountIds: number[]
  accountLookup: AccountLookup
  emptyHint: string
}) {
  const items = accountIds.map(accountItemId)
  // Empty SortableContexts don't register a drop target on their own — without
  // this useDroppable, you couldn't drop an account into a fresh empty group.
  const { setNodeRef, isOver } = useDroppable({ id: containerId })
  return (
    <SortableContext id={containerId} items={items} strategy={verticalListSortingStrategy}>
      <ul
        ref={setNodeRef}
        id={containerId}
        data-testid={containerId}
        className={cn(
          'flex min-h-12 flex-col gap-2 rounded-md transition-colors',
          isOver && 'bg-primary/10 ring-primary/40 ring-2 ring-inset',
        )}
      >
        {accountIds.length === 0 ? (
          <li className="text-muted-foreground rounded-md border border-dashed border-transparent px-2 py-3 text-center text-xs">
            {emptyHint}
          </li>
        ) : null}
        {accountIds.map((id) => {
          const account = accountLookup.get(id)
          if (!account) return null
          return <DraggableAccountItem key={id} account={account} />
        })}
      </ul>
    </SortableContext>
  )
}

function DraggableAccountItem({ account }: { account: AccountWithBank }) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: accountItemId(account.id),
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Hide the source item completely while it's mirrored by DragOverlay — a
    // dim opacity would just leave a ghost behind the floating preview.
    opacity: isDragging ? 0 : 1,
  }

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const { mutateAsync, isPending } = useUpdateAccount()

  const startEditing = () => {
    setDraft(account.display_name ?? '')
    setEditing(true)
  }

  const cancel = () => setEditing(false)

  const commit = async () => {
    const trimmed = draft.trim()
    const nextValue: string | null = trimmed.length === 0 ? null : trimmed
    setEditing(false)
    if (nextValue === (account.display_name ?? null)) return
    try {
      await mutateAsync({ accountId: account.id, display_name: nextValue })
      toast.success(t('credentials.groups.renameSaved'))
    } catch {
      toast.error(t('credentials.groups.renameFailed'))
    }
  }

  if (editing) {
    return (
      <AccountItemView
        account={account}
        ref={setNodeRef}
        style={style}
        // No drag listeners while editing — the user is focused on text input.
        body={
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
            }}
            // Blur fires after the click on cancel/commit buttons has been
            // processed, so the explicit buttons still work. Plain blur (e.g.
            // tapping outside the row) commits.
            onBlur={() => void commit()}
            aria-label={t('credentials.groups.editAccountName')}
            placeholder={account.name}
            maxLength={150}
            disabled={isPending}
            className="h-7 flex-1"
          />
        }
        trailing={
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void commit()}
              aria-label={t('common.save')}
              disabled={isPending}
            >
              <Check className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={cancel}
              aria-label={t('common.cancel')}
              disabled={isPending}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </>
        }
      />
    )
  }

  return (
    <AccountItemView
      account={account}
      ref={setNodeRef}
      style={style}
      handleProps={{ ...attributes, ...listeners }}
      trailing={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={startEditing}
          aria-label={t('credentials.groups.editAccountName')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      }
    />
  )
}

interface AccountItemViewProps {
  account: AccountWithBank
  ref?: React.Ref<HTMLLIElement>
  style?: React.CSSProperties
  handleProps?: React.HTMLAttributes<HTMLButtonElement>
  dragging?: boolean
  body?: React.ReactNode
  trailing?: React.ReactNode
}

function AccountItemView({
  account,
  ref,
  style,
  handleProps,
  dragging,
  body,
  trailing,
}: AccountItemViewProps) {
  const { t } = useTranslation()
  return (
    <li
      ref={ref}
      style={style}
      className={cn(
        'border-border/40 bg-background flex items-center gap-2 rounded-md border px-2 py-2 text-sm',
        dragging && 'shadow-lg ring-primary/40 ring-2',
      )}
    >
      <button
        type="button"
        {...handleProps}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none active:cursor-grabbing"
        aria-label={t('credentials.groups.dragAccount')}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <BankLogo
        icon={account.bankIcon}
        name={account.bankName ?? account.bank}
        seed={account.bankName ?? account.bank}
        className="size-5 shrink-0"
      />
      {body ?? <span className="flex-1 truncate">{accountDisplayName(account)}</span>}
      {trailing}
    </li>
  )
}

// ----- helpers -----

function moveAccount(
  layout: AccountGroupLayout,
  accountId: number,
  overId: string,
  insertAfter = false,
): AccountGroupLayout {
  // overId is either "container-<id>" (empty container drop) or "account-<id>" (hovering an item).
  // Strip "container-" / "account-" prefixes to figure out the target.
  const targetContainerId = parseTargetContainer(overId, layout)
  if (targetContainerId === null) return layout

  // Remove account from wherever it currently lives.
  const groups = layout.groups.map((group) => ({
    ...group,
    accounts: group.accounts.filter((a) => a.id !== accountId),
  }))
  const ungrouped = layout.ungrouped.filter((a) => a.id !== accountId)

  // Figure out the insertion index. If overId is an account item, insert before
  // or after it (caller decides based on cursor position relative to its midpoint);
  // otherwise append.
  if (overId.startsWith('account-')) {
    const overAccountId = accountIdFromItemId(overId)
    const offset = insertAfter ? 1 : 0
    if (targetContainerId === UNGROUPED_ID) {
      const index = ungrouped.findIndex((a) => a.id === overAccountId)
      if (index >= 0) ungrouped.splice(index + offset, 0, { id: accountId })
      else ungrouped.push({ id: accountId })
    } else {
      const group = groups.find((g) => g.id === targetContainerId)
      if (group) {
        const index = group.accounts.findIndex((a) => a.id === overAccountId)
        if (index >= 0) group.accounts.splice(index + offset, 0, { id: accountId })
        else group.accounts.push({ id: accountId })
      }
    }
  } else {
    // Dropped on the container itself → append to the end.
    if (targetContainerId === UNGROUPED_ID) {
      ungrouped.push({ id: accountId })
    } else {
      const group = groups.find((g) => g.id === targetContainerId)
      if (group) group.accounts.push({ id: accountId })
    }
  }
  return { groups, ungrouped }
}

function moveGroup(
  layout: AccountGroupLayout,
  fromGroupId: number,
  toGroupId: number,
): AccountGroupLayout {
  if (fromGroupId === toGroupId) return layout
  const fromIndex = layout.groups.findIndex((g) => g.id === fromGroupId)
  const toIndex = layout.groups.findIndex((g) => g.id === toGroupId)
  if (fromIndex < 0 || toIndex < 0) return layout
  return { ...layout, groups: arrayMove(layout.groups, fromIndex, toIndex) }
}

// Decide before-vs-after based on the dragged item's translated center relative
// to the hovered item's center. Without this, dropping on the last item in a
// group always lands the dragged item *before* it (position N-1 instead of N).
function shouldInsertAfter(
  active: { rect: { current: { translated: { top: number; height: number } | null } } },
  over: { id: string | number; rect: { top: number; height: number } } | null,
): boolean {
  if (!over || !String(over.id).startsWith('account-')) return false
  const translated = active.rect.current.translated
  if (!translated) return false
  const activeMid = translated.top + translated.height / 2
  const overMid = over.rect.top + over.rect.height / 2
  return activeMid > overMid
}

function parseTargetContainer(
  overId: string,
  layout: AccountGroupLayout,
): number | typeof UNGROUPED_ID | null {
  if (overId.startsWith('container-')) {
    const raw = overId.replace('container-', '')
    if (raw === UNGROUPED_ID) return UNGROUPED_ID
    return Number(raw)
  }
  if (overId.startsWith('account-')) {
    const id = accountIdFromItemId(overId)
    for (const group of layout.groups) {
      if (group.accounts.some((a) => a.id === id)) return group.id
    }
    if (layout.ungrouped.some((a) => a.id === id)) return UNGROUPED_ID
  }
  return null
}

function toWritePayload(layout: AccountGroupLayout): AccountGroupLayoutWrite {
  return {
    groups: layout.groups.map((group) => ({
      // Negative ids are placeholders for "create me" — drop them so the server
      // assigns a real id.
      ...(group.id > 0 ? { id: group.id } : {}),
      name: group.name.trim() || 'Group',
      account_ids: group.accounts.map((a) => a.id),
    })),
    ungrouped: layout.ungrouped.map((a) => a.id),
  }
}

function sameLayout(a: AccountGroupLayout, b: AccountGroupLayout): boolean {
  if (a.groups.length !== b.groups.length) return false
  if (a.ungrouped.length !== b.ungrouped.length) return false
  for (let i = 0; i < a.groups.length; i++) {
    const ga = a.groups[i]
    const gb = b.groups[i]
    if (ga.id !== gb.id) return false
    if (ga.name !== gb.name) return false
    if (ga.accounts.length !== gb.accounts.length) return false
    for (let j = 0; j < ga.accounts.length; j++) {
      if (ga.accounts[j].id !== gb.accounts[j].id) return false
    }
  }
  for (let i = 0; i < a.ungrouped.length; i++) {
    if (a.ungrouped[i].id !== b.ungrouped[i].id) return false
  }
  return true
}

// Re-export for tests so they can verify the pure logic without DnD setup.
export const __testing = {
  moveAccount,
  moveGroup,
  parseTargetContainer,
  toWritePayload,
  sameLayout,
  buildAccountLookup,
  shouldInsertAfter,
}
export type { AccountWithBank, AccountLookup }
