/** Persistent side-panel workbench state and tree-editing actions. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** One open tab: the app registration key and its strip title. */
export interface SidePanelTab {
  /** Keyed registration key of the app slot (`btw`, `terminal`, …). */
  readonly id: string
  /** Localized title shown in the tab strip. */
  readonly title: string
}

/** A tab group at one leaf of the split tree. */
export interface SidePanelLeaf {
  readonly kind: 'leaf'
  readonly id: string
  readonly tabs: readonly SidePanelTab[]
  readonly active: string | null
}

/** Split orientation: horizontal places children left/right; vertical places them top/bottom. */
export type SidePanelSplitDirection = 'horizontal' | 'vertical'

/** A resizable branch of the side-panel split tree. */
export interface SidePanelSplit {
  readonly kind: 'split'
  readonly id: string
  readonly direction: SidePanelSplitDirection
  readonly sizes: readonly number[]
  readonly children: readonly SidePanelNode[]
}

/** One node in the recursive side-panel layout. */
export type SidePanelNode = SidePanelLeaf | SidePanelSplit

/** A tab's target area during drag and drop. */
export type SidePanelDropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

type SidePanelState = {
  root: SidePanelNode
  activePane: string
  nextPane: number
  nextSplit: number
}

type SidePanelActions = {
  openTab: (draft: SidePanelState, tab: SidePanelTab, paneId?: string) => void
  closeTab: (draft: SidePanelState, paneId: string, tabId: string) => void
  setActive: (draft: SidePanelState, paneId: string, tabId: string) => void
  focusPane: (draft: SidePanelState, paneId: string) => void
  moveTab: (
    draft: SidePanelState,
    sourcePaneId: string,
    tabId: string,
    targetPaneId: string,
    zone: SidePanelDropZone,
    beforeTabId?: string,
  ) => void
  resizeSplit: (draft: SidePanelState, splitId: string, dividerIndex: number, delta: number) => void
}

function emptyLeaf(id: string): SidePanelLeaf {
  return { kind: 'leaf', id, tabs: [], active: null }
}

function findLeaf(node: SidePanelNode, paneId: string): SidePanelLeaf | undefined {
  if (node.kind === 'leaf') return node.id === paneId ? node : undefined
  for (const child of node.children) {
    const found = findLeaf(child, paneId)
    if (found !== undefined) return found
  }
  return undefined
}

function findTab(node: SidePanelNode, tabId: string): { leaf: SidePanelLeaf; tab: SidePanelTab } | undefined {
  if (node.kind === 'leaf') {
    const tab = node.tabs.find(candidate => candidate.id === tabId)
    return tab === undefined ? undefined : { leaf: node, tab }
  }
  for (const child of node.children) {
    const found = findTab(child, tabId)
    if (found !== undefined) return found
  }
  return undefined
}

function firstLeaf(node: SidePanelNode): SidePanelLeaf {
  if (node.kind === 'leaf') return node
  const child = node.children[0]
  if (child === undefined) throw new Error(`sidepanel split ${node.id} has no children`)
  return firstLeaf(child)
}

function replaceNode(
  node: SidePanelNode,
  id: string,
  replacement: (current: SidePanelNode) => SidePanelNode,
): SidePanelNode {
  if (node.id === id) return replacement(node)
  if (node.kind === 'leaf') return node
  return { ...node, children: node.children.map(child => replaceNode(child, id, replacement)) }
}

function updateLeaf(
  node: SidePanelNode,
  paneId: string,
  update: (leaf: SidePanelLeaf) => SidePanelLeaf,
): SidePanelNode {
  return replaceNode(node, paneId, current => current.kind === 'leaf' ? update(current) : current)
}

function removeEmptyPane(node: SidePanelNode, paneId: string, keepRoot: boolean): SidePanelNode | undefined {
  if (node.kind === 'leaf') {
    if (node.id !== paneId || node.tabs.length > 0 || keepRoot) return node
    return undefined
  }
  const children = node.children
    .map(child => removeEmptyPane(child, paneId, false))
    .filter((child): child is SidePanelNode => child !== undefined)
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  if (children.length === node.children.length) return { ...node, children }
  return { ...node, children, sizes: children.map(() => 1 / children.length) }
}

function removeTab(leaf: SidePanelLeaf, tabId: string): SidePanelLeaf {
  const index = leaf.tabs.findIndex(tab => tab.id === tabId)
  if (index === -1) return leaf
  const tabs = leaf.tabs.filter(tab => tab.id !== tabId)
  const active = leaf.active === tabId
    ? tabs.at(Math.max(0, index - 1))?.id ?? null
    : leaf.active
  return { ...leaf, tabs, active }
}

function insertTab(leaf: SidePanelLeaf, tab: SidePanelTab, beforeTabId?: string): SidePanelLeaf {
  const tabs = leaf.tabs.filter(candidate => candidate.id !== tab.id)
  const index = beforeTabId === undefined ? -1 : tabs.findIndex(candidate => candidate.id === beforeTabId)
  if (index === -1) tabs.push(tab)
  else tabs.splice(index, 0, tab)
  return { ...leaf, tabs, active: tab.id }
}

function splitDirection(zone: SidePanelDropZone): SidePanelSplitDirection {
  return zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Create a session-scoped side-panel workbench store.
 * @returns the recursive layout store and its tab, split, and resize actions.
 */
export function createSidePanelStore(): EngineStoreHandle<SidePanelState, SidePanelActions> {
  return defineStore({
    init: (): SidePanelState => ({
      root: emptyLeaf('pane:0'),
      activePane: 'pane:0',
      nextPane: 1,
      nextSplit: 0,
    }),
    persist: 'dsh.sidepanel.workbench',
    actions: {
      openTab: (draft, tab, requestedPaneId) => {
        const existing = findTab(draft.root, tab.id)
        if (existing !== undefined) {
          draft.root = updateLeaf(draft.root, existing.leaf.id, leaf => ({ ...leaf, active: tab.id }))
          draft.activePane = existing.leaf.id
          return
        }
        const pane = requestedPaneId !== undefined && findLeaf(draft.root, requestedPaneId) !== undefined
          ? requestedPaneId
          : findLeaf(draft.root, draft.activePane)?.id ?? firstLeaf(draft.root).id
        draft.root = updateLeaf(draft.root, pane, leaf => insertTab(leaf, tab))
        draft.activePane = pane
      },
      closeTab: (draft, paneId, tabId) => {
        const pane = findLeaf(draft.root, paneId)
        if (pane?.tabs.some(tab => tab.id === tabId) !== true) return
        draft.root = updateLeaf(draft.root, paneId, leaf => removeTab(leaf, tabId))
        draft.root = removeEmptyPane(draft.root, paneId, true) ?? emptyLeaf('pane:0')
        if (findLeaf(draft.root, draft.activePane) === undefined) {
          draft.activePane = firstLeaf(draft.root).id
        }
      },
      setActive: (draft, paneId, tabId) => {
        const pane = findLeaf(draft.root, paneId)
        if (pane?.tabs.some(tab => tab.id === tabId) !== true) return
        draft.root = updateLeaf(draft.root, paneId, leaf => ({ ...leaf, active: tabId }))
        draft.activePane = paneId
      },
      focusPane: (draft, paneId) => {
        if (findLeaf(draft.root, paneId) !== undefined) draft.activePane = paneId
      },
      moveTab: (draft, sourcePaneId, tabId, targetPaneId, zone, beforeTabId) => {
        const source = findLeaf(draft.root, sourcePaneId)
        const target = findLeaf(draft.root, targetPaneId)
        const tab = source?.tabs.find(candidate => candidate.id === tabId)
        if (source === undefined || target === undefined || tab === undefined) return

        if (zone === 'center') {
          if (sourcePaneId === targetPaneId && beforeTabId === tabId) return
          if (sourcePaneId === targetPaneId) {
            draft.root = updateLeaf(draft.root, sourcePaneId, leaf => insertTab(removeTab(leaf, tabId), tab, beforeTabId))
          } else {
            draft.root = updateLeaf(draft.root, sourcePaneId, leaf => removeTab(leaf, tabId))
            draft.root = removeEmptyPane(draft.root, sourcePaneId, true) ?? emptyLeaf('pane:0')
            draft.root = updateLeaf(draft.root, targetPaneId, leaf => insertTab(leaf, tab, beforeTabId))
          }
          draft.activePane = targetPaneId
          return
        }

        draft.root = updateLeaf(draft.root, sourcePaneId, leaf => removeTab(leaf, tabId))
        if (sourcePaneId !== targetPaneId) {
          draft.root = removeEmptyPane(draft.root, sourcePaneId, true) ?? emptyLeaf('pane:0')
        }
        if (findLeaf(draft.root, targetPaneId) === undefined) return

        const newPaneId = `pane:${draft.nextPane}`
        const newSplitId = `split:${draft.nextSplit}`
        draft.nextPane += 1
        draft.nextSplit += 1
        const newPane: SidePanelLeaf = { kind: 'leaf', id: newPaneId, tabs: [tab], active: tab.id }
        const before = zone === 'left' || zone === 'top'
        draft.root = replaceNode(draft.root, targetPaneId, (current) => {
          const children = before ? [newPane, current] : [current, newPane]
          return {
            kind: 'split',
            id: newSplitId,
            direction: splitDirection(zone),
            sizes: [0.5, 0.5],
            children,
          }
        })
        draft.activePane = newPaneId
      },
      resizeSplit: (draft, splitId, dividerIndex, delta) => {
        draft.root = replaceNode(draft.root, splitId, (current) => {
          if (current.kind !== 'split') return current
          const left = current.sizes[dividerIndex]
          const right = current.sizes[dividerIndex + 1]
          if (left === undefined || right === undefined) return current
          const total = left + right
          const nextLeft = Math.min(total - 0.1, Math.max(0.1, left + delta))
          const sizes = [...current.sizes]
          sizes[dividerIndex] = rounded(nextLeft)
          sizes[dividerIndex + 1] = rounded(total - nextLeft)
          return { ...current, sizes }
        })
      },
    },
  })
}
