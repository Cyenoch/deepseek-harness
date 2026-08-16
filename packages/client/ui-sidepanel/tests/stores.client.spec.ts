// @vitest-environment jsdom
/**
 * Side panel tab store semantics: open-reuse-activate, close focus fallback,
 * setActive guarding against unopened ids, and per-key persistence.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createSidePanelStore } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/stores.ts'
import type {
  SidePanelDropZone, SidePanelTab,
} from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/stores.ts'

beforeEach(() => { localStorage.clear() })

describe('createSidePanelStore', () => {
  it('moves a tab to an edge split and collapses the empty pane after close', () => {
    const { store, actions } = createSidePanelStore().create()
    const workbench = actions as unknown as {
      moveTab: (sourcePaneId: string, tabId: string, targetPaneId: string, zone: 'right') => void
      closeTab: (paneId: string, tabId: string) => void
    }
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })

    workbench.moveTab('pane:0', 'terminal', 'pane:0', 'right')
    expect(store.getSnapshot()).toMatchObject({
      activePane: 'pane:1',
      root: {
        kind: 'split',
        direction: 'horizontal',
        sizes: [0.5, 0.5],
        children: [
          { kind: 'leaf', id: 'pane:0', tabs: [{ id: 'btw', title: 'A' }], active: 'btw' },
          { kind: 'leaf', id: 'pane:1', tabs: [{ id: 'terminal', title: 'B' }], active: 'terminal' },
        ],
      },
    })

    workbench.closeTab('pane:1', 'terminal')
    expect(store.getSnapshot()).toMatchObject({
      activePane: 'pane:0',
      root: { kind: 'leaf', id: 'pane:0', tabs: [{ id: 'btw', title: 'A' }], active: 'btw' },
    })
  })

  it.each([
    ['left', 'horizontal', 'terminal'],
    ['right', 'horizontal', 'btw'],
    ['top', 'vertical', 'terminal'],
    ['bottom', 'vertical', 'btw'],
  ] as const)('creates a %s split in the expected direction and order', (zone, direction, firstTab) => {
    const { store, actions } = createSidePanelStore().create()
    const moveTab = (actions as unknown as {
      moveTab: (sourcePaneId: string, tabId: string, targetPaneId: string, zone: SidePanelDropZone) => void
    }).moveTab
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })

    moveTab('pane:0', 'terminal', 'pane:0', zone)
    const snapshot = store.getSnapshot() as unknown as {
      root: { direction: string; children: Array<{ tabs: readonly SidePanelTab[] }> }
    }
    expect(snapshot.root.direction).toBe(direction)
    expect(snapshot.root.children[0]?.tabs[0]?.id).toBe(firstTab)
  })

  it('merges an edge-split tab into a target strip at the requested position', () => {
    const { store, actions } = createSidePanelStore().create()
    const workbench = actions as unknown as {
      moveTab: (
        sourcePaneId: string,
        tabId: string,
        targetPaneId: string,
        zone: 'right' | 'center',
        beforeTabId?: string,
      ) => void
    }
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })
    workbench.moveTab('pane:0', 'terminal', 'pane:0', 'right')
    workbench.moveTab('pane:1', 'terminal', 'pane:0', 'center', 'btw')

    expect(store.getSnapshot()).toMatchObject({
      activePane: 'pane:0',
      root: {
        kind: 'leaf',
        id: 'pane:0',
        tabs: [{ id: 'terminal', title: 'B' }, { id: 'btw', title: 'A' }],
        active: 'terminal',
      },
    })
  })

  it('resizes adjacent panes while preserving a usable minimum', () => {
    const { store, actions } = createSidePanelStore().create()
    const workbench = actions as unknown as {
      moveTab: (sourcePaneId: string, tabId: string, targetPaneId: string, zone: 'right') => void
      resizeSplit: (splitId: string, dividerIndex: number, delta: number) => void
    }
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })
    workbench.moveTab('pane:0', 'terminal', 'pane:0', 'right')
    workbench.resizeSplit('split:0', 0, 0.9)

    expect(store.getSnapshot()).toMatchObject({ root: { sizes: [0.9, 0.1] } })
  })

  it('starts with no tabs and no active id', () => {
    const { store } = createSidePanelStore().create()
    expect(store.getSnapshot()).toEqual({
      root: { kind: 'leaf', id: 'pane:0', tabs: [], active: null },
      activePane: 'pane:0',
      nextPane: 1,
      nextSplit: 0,
    })
  })

  it('opening a fresh tab appends and activates it; re-opening only activates', () => {
    const { store, actions } = createSidePanelStore().create()
    actions.openTab({ id: 'btw', title: '侧边问答' })
    expect(store.getSnapshot().root).toEqual({
      kind: 'leaf',
      id: 'pane:0',
      tabs: [{ id: 'btw', title: '侧边问答' }],
      active: 'btw',
    })
    actions.openTab({ id: 'btw', title: 'ignored duplicate copy' })
    const root = store.getSnapshot().root
    expect(root.kind).toBe('leaf')
    if (root.kind !== 'leaf') throw new Error('expected one tab group')
    expect(root.tabs).toHaveLength(1)
    expect(root.tabs[0]).toEqual({ id: 'btw', title: '侧边问答' })
  })

  it('closing the active tab focuses the preceding tab; closing the last clears active', () => {
    const { store, actions } = createSidePanelStore().create()
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })
    actions.openTab({ id: 'third', title: 'C' })
    actions.closeTab('pane:0', 'third')
    expect(store.getSnapshot().root).toMatchObject({ active: 'terminal' })
    actions.closeTab('pane:0', 'terminal')
    expect(store.getSnapshot().root).toMatchObject({ active: 'btw' })
    actions.closeTab('pane:0', 'btw')
    expect(store.getSnapshot().root).toEqual({ kind: 'leaf', id: 'pane:0', tabs: [], active: null })
  })

  it('closing a background tab keeps the active id; closing an unknown id is a no-op', () => {
    const { store, actions } = createSidePanelStore().create()
    actions.openTab({ id: 'btw', title: 'A' })
    actions.openTab({ id: 'terminal', title: 'B' })
    actions.closeTab('pane:0', 'btw')
    expect(store.getSnapshot().root).toMatchObject({ active: 'terminal', tabs: [{ id: 'terminal', title: 'B' }] })
    actions.closeTab('pane:0', 'ghost')
    expect(store.getSnapshot().root).toMatchObject({ tabs: [{ id: 'terminal', title: 'B' }] })
  })

  it('setActive ignores ids that are not open', () => {
    const { store, actions } = createSidePanelStore().create()
    actions.openTab({ id: 'btw', title: 'A' })
    actions.setActive('pane:0', 'ghost')
    expect(store.getSnapshot().root).toMatchObject({ active: 'btw' })
    actions.setActive('pane:0', 'btw')
    expect(store.getSnapshot().root).toMatchObject({ active: 'btw' })
  })

  it('persists open tabs and restores them on a later create', () => {
    const first = createSidePanelStore().create()
    first.actions.openTab({ id: 'btw', title: '侧边问答' })
    first.actions.openTab({ id: 'terminal', title: '终端' })
    first.actions.setActive('pane:0', 'btw')

    const second = createSidePanelStore().create()
    expect(second.store.getSnapshot()).toEqual({
      root: {
        kind: 'leaf',
        id: 'pane:0',
        tabs: [{ id: 'btw', title: '侧边问答' }, { id: 'terminal', title: '终端' }],
        active: 'btw',
      },
      activePane: 'pane:0',
      nextPane: 1,
      nextSplit: 0,
    })
  })
})
