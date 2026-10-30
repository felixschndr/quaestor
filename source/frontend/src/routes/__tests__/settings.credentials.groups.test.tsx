import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import '@/i18n'

vi.mock('@tanstack/react-router', async () => (await import('./-routerMock')).routerMocks())

import { GroupsEditorView, __testing } from '@/pages/settings.credentials.groups'
import { Route } from '@/routes/settings.credentials.groups'
import type { AccountGroupLayout } from '@/lib/accountGroups'
import type { AccountRead } from '@/lib/auth'
import { bodyOf, buildUser, jsonResponse, renderWithQuery, requestsTo, serve } from '@/test/helpers'
import { buildAccount, buildCredential } from '@/test/statsFixtures'
import {
  ACCOUNT_NAME_CHECKING,
  ACCOUNT_NAME_DAY,
  ACCOUNT_NAME_GIRO,
  ACCOUNT_NAME_SAVINGS,
  GROUP_NAME_SAVINGS,
  SHARE_OWNER_NAME,
} from '@/test/constants'

const {
  moveAccount,
  moveGroup,
  parseTargetContainer,
  toWritePayload,
  sameLayout,
  buildAccountLookup,
  shouldInsertAfter,
} = __testing

const OWN_CREDENTIAL = buildCredential(
  [
    buildAccount({ id: 1, name: ACCOUNT_NAME_GIRO }),
    buildAccount({ id: 2, name: ACCOUNT_NAME_DAY }),
  ],
  { id: 10 },
)

const sampleLayout: AccountGroupLayout = {
  groups: [
    { id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 1 }] },
    { id: 200, name: 'Daily', accounts: [{ id: 2 }] },
  ],
  ungrouped: [],
}

describe('moveAccount', () => {
  it('moves an account from one group to another', () => {
    const next = moveAccount(sampleLayout, 1, 'container-200')
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([])
    expect(next.groups[1].accounts.map((a) => a.id)).toEqual([2, 1])
  })

  it('keeps the layout when an account is dropped onto itself', () => {
    expect(moveAccount(sampleLayout, 1, 'account-1')).toBe(sampleLayout)
  })

  it('moves an account from a group to the ungrouped bucket', () => {
    const next = moveAccount(sampleLayout, 1, 'container-ungrouped')
    expect(next.groups[0].accounts).toEqual([])
    expect(next.ungrouped.map((a) => a.id)).toEqual([1])
  })

  it('reorders within the same group by inserting before the hovered account', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
      ungrouped: [],
    }
    // Move 30 onto 10 → 30 lands before 10.
    const next = moveAccount(layout, 30, 'account-10')
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([30, 10, 20])
  })

  it('inserts after the hovered account when insertAfter is true', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }, { id: 20 }, { id: 30 }] }],
      ungrouped: [{ id: 40 }],
    }
    // Drop 40 onto 30 with cursor in 30's lower half → 40 lands at the very end.
    const next = moveAccount(layout, 40, 'account-30', true)
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([10, 20, 30, 40])
    expect(next.ungrouped).toEqual([])
  })

  it('returns the layout unchanged when the drop target is unknown', () => {
    expect(moveAccount(sampleLayout, 1, 'mystery-target')).toBe(sampleLayout)
  })

  it('inserts before an account hovered in the ungrouped bucket', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [{ id: 20 }, { id: 30 }],
    }
    const next = moveAccount(layout, 10, 'account-30')
    expect(next.groups[0].accounts).toEqual([])
    expect(next.ungrouped.map((a) => a.id)).toEqual([20, 10, 30])
  })
})

describe('parseTargetContainer', () => {
  it('resolves container drops directly', () => {
    expect(parseTargetContainer('container-200', sampleLayout)).toBe(200)
    expect(parseTargetContainer('container-ungrouped', sampleLayout)).toBe('ungrouped')
  })

  it('resolves item drops to their owning container', () => {
    expect(parseTargetContainer('account-1', sampleLayout)).toBe(100)
    expect(parseTargetContainer('account-2', sampleLayout)).toBe(200)
  })

  it('returns null for unknown drop ids', () => {
    expect(parseTargetContainer('unknown', sampleLayout)).toBeNull()
  })

  it('returns null for an account that sits in no container', () => {
    expect(parseTargetContainer('account-99', sampleLayout)).toBeNull()
  })
})

describe('toWritePayload', () => {
  it('keeps positive group ids and drops placeholder negative ids', () => {
    const layout: AccountGroupLayout = {
      groups: [
        { id: 100, name: 'Existing', accounts: [{ id: 1 }] },
        { id: -42, name: 'Placeholder', accounts: [{ id: 2 }] },
      ],
      ungrouped: [{ id: 3 }],
    }
    const payload = toWritePayload(layout)
    expect(payload.groups[0]).toEqual({ id: 100, name: 'Existing', account_ids: [1] })
    // No id on the placeholder — the server will assign one.
    expect(payload.groups[1]).toEqual({ name: 'Placeholder', account_ids: [2] })
    expect(payload.ungrouped).toEqual([3])
  })

  it('falls back to a default name when the user empties the input', () => {
    const layout: AccountGroupLayout = {
      groups: [{ id: -1, name: '   ', accounts: [] }],
      ungrouped: [],
    }
    expect(toWritePayload(layout).groups[0].name).toBe('Group')
  })
})

describe('sameLayout', () => {
  it('returns true for layouts that match group-by-group and account-by-account', () => {
    const a: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [{ id: 20 }],
    }
    const b: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [{ id: 20 }],
    }
    expect(sameLayout(a, b)).toBe(true)
  })

  it('detects renames, reorders and reassignments as different', () => {
    const base: AccountGroupLayout = {
      groups: [{ id: 1, name: 'A', accounts: [{ id: 10 }] }],
      ungrouped: [],
    }
    expect(sameLayout(base, { ...base, groups: [{ ...base.groups[0], name: 'Renamed' }] })).toBe(
      false,
    )
    expect(
      sameLayout(base, {
        ...base,
        groups: [{ ...base.groups[0], accounts: [{ id: 10 }, { id: 11 }] }],
      }),
    ).toBe(false)
  })
})

describe('moveGroup', () => {
  const threeGroups: AccountGroupLayout = {
    groups: [
      { id: 1, name: 'A', accounts: [] },
      { id: 2, name: 'B', accounts: [] },
      { id: 3, name: 'C', accounts: [] },
    ],
    ungrouped: [],
  }

  it('moves the first group to the end', () => {
    const next = moveGroup(threeGroups, 1, 3)
    expect(next.groups.map((g) => g.id)).toEqual([2, 3, 1])
  })

  it('moves the last group to the start', () => {
    const next = moveGroup(threeGroups, 3, 1)
    expect(next.groups.map((g) => g.id)).toEqual([3, 1, 2])
  })

  it('preserves account assignments while moving', () => {
    const layout: AccountGroupLayout = {
      groups: [
        { id: 1, name: 'A', accounts: [{ id: 10 }] },
        { id: 2, name: 'B', accounts: [{ id: 20 }, { id: 21 }] },
      ],
      ungrouped: [{ id: 99 }],
    }
    const next = moveGroup(layout, 1, 2)
    expect(next.groups.map((g) => g.id)).toEqual([2, 1])
    expect(next.groups[1].accounts.map((a) => a.id)).toEqual([10])
    expect(next.groups[0].accounts.map((a) => a.id)).toEqual([20, 21])
    expect(next.ungrouped).toEqual([{ id: 99 }])
  })

  it('returns the layout unchanged when from === to or ids are unknown', () => {
    expect(moveGroup(threeGroups, 1, 1)).toBe(threeGroups)
    expect(moveGroup(threeGroups, 99, 1)).toBe(threeGroups)
    expect(moveGroup(threeGroups, 1, 99)).toBe(threeGroups)
  })
})

describe('shouldInsertAfter', () => {
  const overItem = { id: 'account-10', rect: { top: 100, height: 40 } }
  // over midpoint = 120

  it('returns true when the dragged item is past the over item midpoint', () => {
    const active = { rect: { current: { translated: { top: 110, height: 40 } } } }
    // active midpoint = 130 > 120
    expect(shouldInsertAfter(active, overItem)).toBe(true)
  })

  it('returns false when the dragged item sits above the over item midpoint', () => {
    const active = { rect: { current: { translated: { top: 80, height: 40 } } } }
    // active midpoint = 100 < 120
    expect(shouldInsertAfter(active, overItem)).toBe(false)
  })

  it('returns false before the dragged item has a translated rect', () => {
    expect(shouldInsertAfter({ rect: { current: { translated: null } } }, overItem)).toBe(false)
  })

  it('returns false when dropping on a container (not an account item)', () => {
    const active = { rect: { current: { translated: { top: 500, height: 40 } } } }
    const overContainer = { id: 'container-200', rect: { top: 100, height: 40 } }
    expect(shouldInsertAfter(active, overContainer)).toBe(false)
  })
})

describe('buildAccountLookup', () => {
  it('flattens accounts across credentials and tags each with its bank', () => {
    const lookup = buildAccountLookup(buildUser({ credentials: [OWN_CREDENTIAL] }))
    expect(lookup.get(1)?.bank).toBe('ing')
    expect(lookup.get(2)?.name).toBe(ACCOUNT_NAME_DAY)
    expect(lookup.size).toBe(2)
  })

  it('returns an empty map when the user is missing', () => {
    expect(buildAccountLookup(undefined).size).toBe(0)
  })
})

const SHARED_ACCOUNT_ID = 3
const DAILY_GROUP_NAME = 'Daily'

function buildUserWithShare(overrides: Partial<AccountRead> = {}) {
  return buildUser({
    credentials: [
      OWN_CREDENTIAL,
      buildCredential(
        [buildAccount({ id: SHARED_ACCOUNT_ID, name: ACCOUNT_NAME_SAVINGS, ...overrides })],
        { id: 20, bank: 'dkb', shared_from: SHARE_OWNER_NAME, share_permission: 'write' },
      ),
    ],
  })
}

const editorLayout: AccountGroupLayout = {
  groups: [
    { id: 100, name: GROUP_NAME_SAVINGS, accounts: [{ id: 1 }] },
    { id: 200, name: DAILY_GROUP_NAME, accounts: [{ id: 2 }] },
  ],
  ungrouped: [{ id: SHARED_ACCOUNT_ID }],
}

const LAYOUT_URL = '/api/account_groups/layout'
const DEBOUNCE_MS = 400

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

function serveLayoutSave() {
  serve({ [`PUT ${LAYOUT_URL}`]: { status: 200, body: editorLayout } })
}

function renderEditor(layout: AccountGroupLayout = editorLayout, user = buildUserWithShare()) {
  return renderWithQuery(
    <GroupsEditorView layout={layout} accountLookup={buildAccountLookup(user)} />,
  )
}

function groupNames(): string[] {
  return screen
    .getAllByRole('textbox', { name: 'Group name' })
    .map((input) => (input as HTMLInputElement).value)
}

function accountsIn(containerId: string): string[] {
  return within(screen.getByTestId(containerId))
    .queryAllByRole('button', { name: 'Edit account name' })
    .map((button) => button.closest('li')!.textContent!)
}

async function flushDebounce() {
  await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS))
}

afterEach(async () => {
  if (vi.isFakeTimers()) await act(() => vi.runOnlyPendingTimersAsync())
  vi.useRealTimers()
})

describe('GroupsEditorView — layout edits', () => {
  function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    serveLayoutSave()
    const success = vi.spyOn(toast, 'success')
    renderEditor()
    return { user, success }
  }

  it('asks the user to connect a bank first when there are no accounts', () => {
    renderWithQuery(<GroupsEditorView layout={editorLayout} accountLookup={new Map()} />)
    expect(
      screen.getByText('Connect a bank first — then come back here to organise your accounts.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create group' })).not.toBeInTheDocument()
  })

  it('places every account in its group and the rest under "Without group"', () => {
    renderEditor()
    expect(groupNames()).toEqual([GROUP_NAME_SAVINGS, DAILY_GROUP_NAME])
    expect(accountsIn('container-100')).toEqual([expect.stringContaining(ACCOUNT_NAME_GIRO)])
    expect(accountsIn('container-200')).toEqual([expect.stringContaining(ACCOUNT_NAME_DAY)])
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
    ])
  })

  it('skips layout entries whose account no longer exists', () => {
    renderEditor({ ...editorLayout, ungrouped: [{ id: SHARED_ACCOUNT_ID }, { id: 99 }] })
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
    ])
  })

  it('creates a group and saves it without an id once the debounce elapses', async () => {
    const { user, success } = setup()

    await user.click(screen.getByRole('button', { name: 'Create group' }))
    expect(groupNames()).toEqual([GROUP_NAME_SAVINGS, DAILY_GROUP_NAME, 'New group'])
    expect(within(screen.getByTestId(/^container--\d+$/)).getByText('Drop accounts here'))
    expect(requestsTo('PUT', LAYOUT_URL)).toHaveLength(0)

    await flushDebounce()

    await waitFor(() => expect(success).toHaveBeenCalledWith('Saved'))
    expect(bodyOf('PUT', LAYOUT_URL)).toEqual({
      groups: [
        { id: 100, name: GROUP_NAME_SAVINGS, account_ids: [1] },
        { id: 200, name: DAILY_GROUP_NAME, account_ids: [2] },
        { name: 'New group', account_ids: [] },
      ],
      ungrouped: [SHARED_ACCOUNT_ID],
    })
  })

  it('coalesces a burst of renames into a single save', async () => {
    const { user } = setup()

    const [firstName] = screen.getAllByRole('textbox', { name: 'Group name' })
    await user.clear(firstName)
    await user.type(firstName, ACCOUNT_NAME_CHECKING)
    await flushDebounce()

    await waitFor(() => expect(requestsTo('PUT', LAYOUT_URL)).toHaveLength(1))
    expect(bodyOf('PUT', LAYOUT_URL)).toMatchObject({
      groups: [{ id: 100, name: ACCOUNT_NAME_CHECKING }, { id: 200 }],
    })
  })

  it('moves the accounts of a deleted group to "Without group"', async () => {
    const { user } = setup()

    await user.click(screen.getAllByRole('button', { name: 'Delete group' })[0])

    expect(groupNames()).toEqual([DAILY_GROUP_NAME])
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
      expect.stringContaining(ACCOUNT_NAME_GIRO),
    ])
    await flushDebounce()
    await waitFor(() =>
      expect(bodyOf('PUT', LAYOUT_URL)).toEqual({
        groups: [{ id: 200, name: DAILY_GROUP_NAME, account_ids: [2] }],
        ungrouped: [SHARED_ACCOUNT_ID, 1],
      }),
    )
  })

  it('shows a saving hint while the layout request is in flight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let respond: (response: Response) => void = () => {}
    serve({}, () => new Promise((resolve) => (respond = resolve)))
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Create group' }))
    await flushDebounce()

    expect(await screen.findByText('Saving …')).toBeInTheDocument()
    await act(async () => respond(jsonResponse({ status: 200, body: editorLayout })))
    await waitFor(() => expect(screen.queryByText('Saving …')).not.toBeInTheDocument())
  })

  it('toasts an error when the layout cannot be saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    serve({ [`PUT ${LAYOUT_URL}`]: { status: 500, body: { detail: 'boom' } } })
    const error = vi.spyOn(toast, 'error')
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Create group' }))
    await flushDebounce()

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Could not save the layout. Please try again.'),
    )
  })

  it('adopts a new server layout without saving it back', async () => {
    serve({})
    const accountLookup = buildAccountLookup(buildUserWithShare())
    const { rerender } = renderWithQuery(
      <GroupsEditorView layout={editorLayout} accountLookup={accountLookup} />,
    )

    rerender(
      <GroupsEditorView
        layout={{ groups: [], ungrouped: [{ id: 1 }, { id: 2 }, { id: SHARED_ACCOUNT_ID }] }}
        accountLookup={accountLookup}
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'Group name' })).not.toBeInTheDocument()
    expect(accountsIn('container-ungrouped')).toHaveLength(3)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('GroupsEditorView — drag and drop', () => {
  function placeDropTarget(target: Element, top = 1000) {
    const height = 64
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const y = this === target ? top : 0
      return {
        x: 0,
        y,
        top: y,
        left: 0,
        right: 800,
        bottom: y + height,
        width: 800,
        height,
        toJSON() {},
      }
    })
  }

  function startDrag(handle: Element) {
    fireEvent.pointerDown(handle, { isPrimary: true, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 10 })
  }

  function moveTo(clientY: number) {
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY })
  }

  function drop(clientY: number) {
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 0, clientY })
  }

  function handleOf(accountName: string): Element {
    return within(screen.getByText(accountName).closest('li')!).getByRole('button', {
      name: 'Move account',
    })
  }

  function setup() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serveLayoutSave()
    renderEditor()
  }

  it('reorders groups by dragging a group handle onto another group', async () => {
    setup()
    const [savingsSection] = screen
      .getAllByRole('textbox', { name: 'Group name' })
      .map((input) => input.closest('section')!)
    placeDropTarget(savingsSection)

    startDrag(screen.getAllByRole('button', { name: 'Reorder group' })[1])
    moveTo(1000)
    drop(1000)

    expect(groupNames()).toEqual([DAILY_GROUP_NAME, GROUP_NAME_SAVINGS])
    await flushDebounce()
    await waitFor(() =>
      expect(bodyOf('PUT', LAYOUT_URL)).toMatchObject({
        groups: [{ id: 200 }, { id: 100 }],
      }),
    )
  })

  it('moves an account into another container and shows it in the drag overlay', async () => {
    setup()
    placeDropTarget(screen.getByTestId('container-ungrouped'))

    startDrag(handleOf(ACCOUNT_NAME_DAY))
    moveTo(1000)
    expect(screen.getAllByText(ACCOUNT_NAME_DAY)).toHaveLength(2)
    drop(1000)

    expect(accountsIn('container-200')).toEqual([])
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
      expect.stringContaining(ACCOUNT_NAME_DAY),
    ])
    await flushDebounce()
    await waitFor(() =>
      expect(bodyOf('PUT', LAYOUT_URL)).toEqual({
        groups: [
          { id: 100, name: GROUP_NAME_SAVINGS, account_ids: [1] },
          { id: 200, name: DAILY_GROUP_NAME, account_ids: [] },
        ],
        ungrouped: [SHARED_ACCOUNT_ID, 2],
      }),
    )
  })

  it('inserts after the hovered account when dropped on its lower half', async () => {
    setup()
    placeDropTarget(screen.getByText(ACCOUNT_NAME_GIRO).closest('li')!)

    startDrag(handleOf(ACCOUNT_NAME_DAY))
    moveTo(1040)
    drop(1040)
    await act(() => vi.runOnlyPendingTimersAsync())

    expect(accountsIn('container-100')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_GIRO),
      expect.stringContaining(ACCOUNT_NAME_DAY),
    ])
  })

  it('inserts before the hovered account when dropped on its upper half', async () => {
    setup()
    placeDropTarget(screen.getByText(ACCOUNT_NAME_GIRO).closest('li')!)

    startDrag(handleOf(ACCOUNT_NAME_DAY))
    moveTo(980)
    drop(980)
    await act(() => vi.runOnlyPendingTimersAsync())

    expect(accountsIn('container-100')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_DAY),
      expect.stringContaining(ACCOUNT_NAME_GIRO),
    ])
  })

  it('drops the drag overlay when the drag is cancelled with Escape', async () => {
    setup()

    startDrag(handleOf(ACCOUNT_NAME_GIRO))
    expect(screen.getAllByText(ACCOUNT_NAME_GIRO)).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await act(() => vi.runOnlyPendingTimersAsync())

    expect(screen.getAllByText(ACCOUNT_NAME_GIRO)).toHaveLength(1)
    expect(accountsIn('container-100')).toEqual([expect.stringContaining(ACCOUNT_NAME_GIRO)])
    await flushDebounce()
    expect(requestsTo('PUT', LAYOUT_URL)).toHaveLength(0)
  })

  it('undoes a move into another group when the drag is cancelled with Escape', async () => {
    setup()
    placeDropTarget(screen.getByTestId('container-ungrouped'))

    startDrag(handleOf(ACCOUNT_NAME_DAY))
    moveTo(1000)
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
      expect.stringContaining(ACCOUNT_NAME_DAY),
    ])
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await act(() => vi.runOnlyPendingTimersAsync())

    expect(accountsIn('container-200')).toEqual([expect.stringContaining(ACCOUNT_NAME_DAY)])
    expect(accountsIn('container-ungrouped')).toEqual([
      expect.stringContaining(ACCOUNT_NAME_SAVINGS),
    ])
    await flushDebounce()
    expect(requestsTo('PUT', LAYOUT_URL)).toHaveLength(0)
  })
})

describe('GroupsEditorView — account names', () => {
  function setup({ status = 200, user = buildUserWithShare() } = {}) {
    serve({}, (_url, init) =>
      init?.method === 'PATCH' ? Promise.resolve(jsonResponse({ status, body: {} })) : null,
    )
    renderEditor(editorLayout, user)
    return userEvent.setup()
  }

  function editButtonOf(accountName: string): HTMLElement {
    return within(screen.getByText(accountName).closest('li')!).getByRole('button', {
      name: 'Edit account name',
    })
  }

  it('renames an own account on Enter', async () => {
    const user = setup()
    const success = vi.spyOn(toast, 'success')

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    const input = screen.getByRole('textbox', { name: 'Edit account name' })
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('placeholder', ACCOUNT_NAME_GIRO)
    await user.type(input, `  ${ACCOUNT_NAME_CHECKING}  {Enter}`)

    await waitFor(() => expect(success).toHaveBeenCalledWith('Saved'))
    expect(requestsTo('PATCH', '/api/account/1')).toHaveLength(1)
    expect(bodyOf('PATCH', '/api/account/1')).toEqual({ display_name: ACCOUNT_NAME_CHECKING })
  })

  it('saves via the check button and on blur', async () => {
    const user = setup()

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    await user.type(screen.getByRole('textbox', { name: 'Edit account name' }), 'A')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/account/1')).toHaveLength(1))

    await user.click(editButtonOf(ACCOUNT_NAME_DAY))
    await user.type(screen.getByRole('textbox', { name: 'Edit account name' }), 'B')
    await user.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/account/2')).toHaveLength(1))
    expect(bodyOf('PATCH', '/api/account/2')).toEqual({ display_name: 'B' })
  })

  it('discards the draft on Escape or the cancel button', async () => {
    const user = setup()

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    await user.type(screen.getByRole('textbox', { name: 'Edit account name' }), 'X{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Edit account name' })).not.toBeInTheDocument()

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    await user.type(screen.getByRole('textbox', { name: 'Edit account name' }), 'Y')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('textbox', { name: 'Edit account name' })).not.toBeInTheDocument()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sends nothing when the name is committed unchanged', async () => {
    const user = setup()

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    await user.keyboard('{Enter}')

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('clears a shared account name through the share-settings endpoint', async () => {
    const user = setup({ user: buildUserWithShare({ display_name: ACCOUNT_NAME_CHECKING }) })

    await user.click(editButtonOf(ACCOUNT_NAME_CHECKING))
    const input = screen.getByRole('textbox', { name: 'Edit account name' })
    expect(input).toHaveValue(ACCOUNT_NAME_CHECKING)
    await user.clear(input)
    await user.keyboard('{Enter}')

    const url = `/api/account_shares/account/${SHARED_ACCOUNT_ID}/mine`
    await waitFor(() => expect(requestsTo('PATCH', url)).toHaveLength(1))
    expect(bodyOf('PATCH', url)).toEqual({ display_name: null })
  })

  it('toasts an error when the rename fails', async () => {
    const user = setup({ status: 500 })
    const error = vi.spyOn(toast, 'error')

    await user.click(editButtonOf(ACCOUNT_NAME_GIRO))
    await user.type(screen.getByRole('textbox', { name: 'Edit account name' }), 'Z{Enter}')

    await waitFor(() => expect(error).toHaveBeenCalledWith('Could not save name.'))
  })
})

describe('/settings/credentials/groups route', () => {
  const Page = Route.options.component!

  it('loads the user and layout, then saves edits back into the cached layout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const savedLayout: AccountGroupLayout = {
      ...editorLayout,
      groups: [...editorLayout.groups, { id: 300, name: 'New group', accounts: [] }],
    }
    let serveLayout: (response: Response) => void = () => {}
    serve(
      {
        'GET /api/auth/me': { status: 200, body: buildUserWithShare() },
        [`PUT ${LAYOUT_URL}`]: { status: 200, body: savedLayout },
      },
      (url, init) =>
        url === LAYOUT_URL && init?.method !== 'PUT'
          ? new Promise((resolve) => (serveLayout = resolve))
          : null,
    )

    renderWithQuery(<Page />)

    expect(await screen.findByRole('heading', { name: 'Account groups' })).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await act(async () => serveLayout(jsonResponse({ status: 200, body: editorLayout })))
    expect(await screen.findByDisplayValue(GROUP_NAME_SAVINGS)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create group' }))
    await flushDebounce()

    await waitFor(() => expect(requestsTo('GET', '/api/auth/me')).toHaveLength(2))
    await flushDebounce()
    expect(requestsTo('PUT', LAYOUT_URL)).toHaveLength(1)
    expect(groupNames()).toEqual([GROUP_NAME_SAVINGS, DAILY_GROUP_NAME, 'New group'])
  })
})
