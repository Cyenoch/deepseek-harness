// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { SidePanelRoot } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/SidePanelRoot.tsx'
import type { SidePanelRootProps } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/contract/slots.ts'
import { createSidePanelStore } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/stores.ts'
import { en } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/locales.ts'

const t = ((key: keyof typeof en) => en[key]) as SidePanelRootProps['t']
const maybeStandardProps = {
  useSessions: (() => { throw new Error('unused') }) as SidePanelRootProps['useSessions'],
  useWorkspaces: (() => { throw new Error('unused') }) as SidePanelRootProps['useWorkspaces'],
  useSession: (() => undefined) as SidePanelRootProps['useSession'],
  sessionId: undefined,
  useProjection: (() => undefined) as SidePanelRootProps['useProjection'],
  useInput: (() => undefined) as SidePanelRootProps['useInput'],
  inputActions: undefined,
} satisfies Pick<SidePanelRootProps, 'useSessions' | 'useWorkspaces' | 'useSession' | 'sessionId' | 'useProjection' | 'useInput' | 'inputActions'>

interface Dispatch { key: string; owner: unknown; opts: Record<string, unknown> }

function tabDragData(): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    setData: (type: string, value: string) => { values.set(type, value) },
    getData: (type: string) => values.get(type) ?? '',
  } as DataTransfer
}

function mockRect(element: Element): void {
  element.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
    toJSON: () => ({}),
  })
}

function dragAt(element: Element, type: 'dragOver' | 'drop', dataTransfer: DataTransfer, x: number, y: number): void {
  const event = createEvent[type](element, { dataTransfer })
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } })
  fireEvent(element, event)
}

function mount() {
  const instance = createSidePanelStore().create()
  const dispatches: Dispatch[] = []
  const renderSlot = ((key: string, owner: object, opts?: { entryKey?: string; fallback?: unknown }) => {
    dispatches.push({ key, owner, opts: { ...opts } })
    if (key === 'sidepanel.launchpad') return <div data-testid="launchpad" />
    if (key === 'sidepanel.app') return <div data-testid={`app-${String(opts?.entryKey)}`} />
    return null
  }) as unknown as SidePanelRootProps['renderSlot']
  const close = vi.fn()
  const subscribe = (fn: () => void) => instance.store.subscribe(fn)
  const getSnapshot = () => instance.store.getSnapshot()
  const useStore = ((sel: (s: unknown) => unknown) =>
    sel(useSyncExternalStore(subscribe, getSnapshot))) as unknown as SidePanelRootProps['useStore']
  const props: SidePanelRootProps = {
    ...maybeStandardProps,
    useStore,
    actions: instance.actions,
    renderSlot,
    close,
    t,
  }
  const utils = render(<SidePanelRoot {...props} />)
  return { instance, dispatches, close, ...utils }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup() })

describe('SidePanelRoot', () => {
  it('renders the launchpad full-view while no tab is open', () => {
    const { getByTestId, queryByTestId, dispatches } = mount()
    expect(getByTestId('launchpad')).toBeTruthy()
    expect(queryByTestId('app-btw')).toBeNull()
    expect(dispatches[0]!.key).toBe('sidepanel.launchpad')
  })

  it('open tabs render as strip rows; the active row dispatches the keyed app', () => {
    const { instance, getByTestId, getByRole, dispatches } = mount()
    act(() => {
      instance.actions.openTab({ id: 'btw', title: '侧边问答' })
      instance.actions.openTab({ id: 'terminal', title: '终端' })
    })
    expect(getByRole('tab', { selected: true }).textContent).toContain('终端')
    expect(getByTestId('app-btw')).toBeTruthy()
    expect(getByTestId('app-terminal')).toBeTruthy()
    expect(getByTestId('app-btw').closest('section')?.hidden).toBe(true)
    expect(getByTestId('app-terminal').closest('section')?.hidden).toBe(false)
    expect(dispatches.filter(d => d.key === 'sidepanel.app').map(d => d.opts.entryKey))
      .toEqual(expect.arrayContaining(['btw', 'terminal']))

    act(() => { fireEvent.click(getByRole('tab', { name: /侧边问答/ })) })
    expect(getByRole('tab', { selected: true }).textContent).toContain('侧边问答')
    expect(getByTestId('app-btw').closest('section')?.hidden).toBe(false)
    expect(getByTestId('app-terminal').closest('section')?.hidden).toBe(true)
  })

  it('closing the last tab through its tab button returns to the launchpad', () => {
    const { instance, getByTestId, getByRole } = mount()
    act(() => { instance.actions.openTab({ id: 'btw', title: '侧边问答' }) })
    expect(getByTestId('app-btw')).toBeTruthy()
    act(() => { fireEvent.click(getByRole('button', { name: 'Close tab' })) })
    expect(instance.getSnapshot().root).toEqual({ kind: 'leaf', id: 'pane:0', tabs: [], active: null })
    expect(getByTestId('launchpad')).toBeTruthy()
  })

  it('the + button shows the launchpad; its open action opens a tab and clears it', () => {
    const { instance, getByTestId, getByRole, dispatches } = mount()
    act(() => { instance.actions.openTab({ id: 'btw', title: '侧边问答' }) })
    act(() => { fireEvent.click(getByRole('button', { name: 'Open a new tab' })) })
    expect(getByTestId('launchpad')).toBeTruthy()
    const owner = dispatches.find(d => d.key === 'sidepanel.launchpad')!.owner as { open: (tab: { id: string; title: string }) => void }
    act(() => { owner.open({ id: 'terminal', title: '终端' }) })
    expect(instance.getSnapshot().root).toMatchObject({ active: 'terminal' })
  })

  it('dispatches the active id with a fallback for an unregistered app', () => {
    const { instance, dispatches } = mount()
    act(() => { instance.actions.openTab({ id: 'ghost', title: '缺失' }) })
    const appDispatch = dispatches.find(d => d.key === 'sidepanel.app' && d.opts.entryKey === 'ghost')!
    expect(appDispatch.opts.entryKey).toBe('ghost')
    expect(appDispatch.opts.fallback).toBeTruthy()
  })

  it('recovers a persisted active-id gap by showing the launchpad', () => {
    const { instance, getByTestId } = mount()
    act(() => { instance.actions.openTab({ id: 'btw', title: 'A' }) })
    // The engine instance's update is the test-only path to a state the
    // actions cannot express: tabs present, active null.
    act(() => {
      instance.store.update((draft) => {
        if (draft.root.kind === 'leaf') draft.root = { ...draft.root, active: null }
      })
    })
    expect(getByTestId('launchpad')).toBeTruthy()
    expect(getByTestId('app-btw').closest('section')?.hidden).toBe(true)
  })

  it('supports arrow-key activation and middle-click close without remounting sibling apps', () => {
    const { instance, getByRole, getByTestId } = mount()
    act(() => {
      instance.actions.openTab({ id: 'btw', title: 'A' })
      instance.actions.openTab({ id: 'terminal', title: 'B' })
    })
    const terminalTab = getByRole('tab', { name: 'B' })
    fireEvent.keyDown(terminalTab, { key: 'ArrowLeft' })
    expect(getByRole('tab', { selected: true }).textContent).toBe('A')
    expect(getByTestId('app-terminal')).toBeTruthy()
    fireEvent(getByRole('tab', { name: 'A' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(instance.getSnapshot().root).toMatchObject({ tabs: [{ id: 'terminal' }] })
  })

  it('drags a tab to an edge split without remounting its app content', () => {
    const { instance, getByRole, getAllByRole, getByTestId } = mount()
    act(() => {
      instance.actions.openTab({ id: 'btw', title: 'A' })
      instance.actions.openTab({ id: 'terminal', title: 'B' })
    })
    const terminalContent = getByTestId('app-terminal')
    const surface = terminalContent.closest('section')!
    mockRect(surface)
    const dataTransfer = tabDragData()

    fireEvent.dragStart(getByRole('tab', { name: 'B' }), { dataTransfer })
    dragAt(surface, 'dragOver', dataTransfer, 99, 50)
    dragAt(surface, 'drop', dataTransfer, 99, 50)

    expect(getAllByRole('tablist')).toHaveLength(2)
    expect(getByRole('separator', { name: 'Resize split' })).toBeTruthy()
    expect(getByTestId('app-terminal')).toBe(terminalContent)
    expect(instance.getSnapshot().root).toMatchObject({ kind: 'split', direction: 'horizontal' })
  })

  it.each([
    ['top', 50, 1, 'terminal'],
    ['bottom', 50, 99, 'btw'],
  ] as const)('previews all five targets and creates a %s split', (zone, x, y, firstTab) => {
    const { instance, container, getByRole, getByTestId } = mount()
    act(() => {
      instance.actions.openTab({ id: 'btw', title: 'A' })
      instance.actions.openTab({ id: 'terminal', title: 'B' })
    })
    const surface = getByTestId('app-terminal').closest('section')!
    mockRect(surface)
    const dataTransfer = tabDragData()

    fireEvent.dragStart(getByRole('tab', { name: 'B' }), { dataTransfer })
    dragAt(surface, 'dragOver', dataTransfer, x, y)

    const guide = container.querySelector('[data-sidepanel-drop-guide]')
    expect(guide).not.toBeNull()
    expect(guide?.querySelectorAll('[data-drop-zone]')).toHaveLength(5)
    expect(guide?.querySelector(`[data-drop-zone='${zone}'][data-active]`)).not.toBeNull()

    dragAt(surface, 'drop', dataTransfer, x, y)
    expect(instance.getSnapshot().root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
      children: [{ tabs: [{ id: firstTab }] }, { tabs: [expect.anything()] }],
    })
  })

  it('renders the launchpad-only shell while the session-maybe store is absent', () => {
    // The framework keeps the selector Hook seat present so the component's
    // Hook order survives blank → session adoption. It returns undefined and
    // actions stay unavailable until a session owns an instance.
    const calls: { key: string; owner: unknown; opts: unknown }[] = []
    const renderSlot = ((key: string, owner: object, opts?: object) => {
      calls.push({ key, owner, opts: { ...opts } })
      if (key === 'sidepanel.launchpad') return <div data-testid="launchpad" />
      return null
    }) as unknown as SidePanelRootProps['renderSlot']
    const utils = render(
      <SidePanelRoot
        {...maybeStandardProps}
        useStore={() => undefined}
        actions={undefined}
        renderSlot={renderSlot}
        close={() => {}}
        t={t}
      />,
    )
    expect(utils.getByTestId('launchpad')).toBeTruthy()
    fireEvent.click(utils.getByRole('button', { name: 'Open a new tab' }))
    const owner = calls.find(c => c.key === 'sidepanel.launchpad')!.owner as { open: (tab: { id: string }) => void }
    expect(() => { owner.open({ id: 'btw' }) }).not.toThrow()
    expect(calls.filter(c => c.key === 'sidepanel.app')).toHaveLength(0)
  })

  it('the panel close button delegates to the injected close action', () => {
    const { getByRole, close } = mount()
    act(() => { fireEvent.click(getByRole('button', { name: 'Close side panel' })) })
    expect(close).toHaveBeenCalledOnce()
  })
})
