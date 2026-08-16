/** VS Code-style tab groups for the layout's persistent side-panel column. */
import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent,
  type ReactNode,
} from 'react'
import {
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconCloseFill14,
  IconCloseOutline16,
  IconFullscreenOutline16,
  IconPlusOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidePanelRootProps } from './contract/slots.ts'
import type {
  SidePanelDropZone, SidePanelLeaf, SidePanelNode, SidePanelSplitDirection, SidePanelTab,
} from './stores.ts'
import css from './SidePanelRoot.module.css'

const FALLBACK_ROOT: SidePanelLeaf = { kind: 'leaf', id: 'pane:0', tabs: [], active: null }
const DRAG_MIME = 'application/x-dsh-sidepanel-tab'

interface DraggedTab { readonly paneId: string; readonly tabId: string }
interface DropTarget {
  readonly paneId: string
  readonly zone: SidePanelDropZone
  readonly beforeTabId?: string
}
interface PaneRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
interface LocatedTab { readonly pane: SidePanelLeaf; readonly tab: SidePanelTab }

function panelId(tabId: string): string {
  return `sidepanel-panel-${encodeURIComponent(tabId).replaceAll('%', '_')}`
}

function tabElementId(tabId: string): string {
  return `sidepanel-tab-${encodeURIComponent(tabId).replaceAll('%', '_')}`
}

function leavesOf(node: SidePanelNode): SidePanelLeaf[] {
  return node.kind === 'leaf' ? [node] : node.children.flatMap(leavesOf)
}

function topRightLeaf(node: SidePanelNode): SidePanelLeaf {
  if (node.kind === 'leaf') return node
  const child = node.direction === 'horizontal' ? node.children.at(-1) : node.children[0]
  if (child === undefined) throw new Error(`sidepanel split ${node.id} has no children`)
  return topRightLeaf(child)
}

function zoneAt(event: DragEvent<HTMLElement>): SidePanelDropZone {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return 'center'
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  const edges = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ] as const
  const closest = edges.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)
  return closest[1] <= 0.3 ? closest[0] : 'center'
}

function decodeDrag(event: DragEvent<HTMLElement>): DraggedTab | undefined {
  try {
    const value = JSON.parse(event.dataTransfer.getData(DRAG_MIME)) as Partial<DraggedTab>
    return typeof value.paneId === 'string' && typeof value.tabId === 'string'
      ? { paneId: value.paneId, tabId: value.tabId }
      : undefined
  } catch (_invalidInternalDragPayload: unknown) {
    return undefined
  }
}

function sameRects(left: Readonly<Record<string, PaneRect>>, right: Readonly<Record<string, PaneRect>>): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => {
    const a = left[key]
    const b = right[key]
    return a !== undefined && b !== undefined
      && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  })
}

function overlayStyle(zone: SidePanelDropZone): CSSProperties {
  if (zone === 'left') return { inset: '0 50% 0 0' }
  if (zone === 'right') return { inset: '0 0 0 50%' }
  if (zone === 'top') return { inset: '0 0 50%' }
  if (zone === 'bottom') return { inset: '50% 0 0' }
  return { inset: 8 }
}

function appStyle(rect: PaneRect | undefined): CSSProperties {
  return rect === undefined ? { visibility: 'hidden' } : rect
}

const DROP_ZONES = ['top', 'left', 'center', 'right', 'bottom'] as const

function DropZoneIcon({ zone }: { readonly zone: SidePanelDropZone }) {
  if (zone === 'top') return <IconChevronUpOutline14 />
  if (zone === 'right') return <IconChevronRightOutline14 />
  if (zone === 'bottom') return <IconChevronDownOutline14 />
  if (zone === 'left') return <IconChevronLeftOutline14 />
  return <IconFullscreenOutline16 size={14} />
}

function dropLabel(t: SidePanelRootProps['t'], zone: SidePanelDropZone): string {
  if (zone === 'top') return t('panel.drop.top')
  if (zone === 'right') return t('panel.drop.right')
  if (zone === 'bottom') return t('panel.drop.bottom')
  if (zone === 'left') return t('panel.drop.left')
  return t('panel.drop.center')
}

function SplitDivider({
  direction,
  label,
  onResize,
}: {
  readonly direction: SidePanelSplitDirection
  readonly label: string
  readonly onResize: (delta: number) => void
}) {
  const pointer = useRef<{ coordinate: number; extent: number } | undefined>()
  const pending = useRef(0)
  const frame = useRef<number | undefined>()

  const flush = (): void => {
    frame.current = undefined
    if (pending.current === 0) return
    const delta = pending.current
    pending.current = 0
    onResize(delta)
  }

  const queue = (delta: number): void => {
    pending.current += delta
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(flush)
  }

  const finish = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointer.current === undefined) return
    pointer.current = undefined
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    flush()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className={css.divider}
      data-direction={direction}
      role="separator"
      aria-label={label}
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      onKeyDown={(event) => {
        const negative = direction === 'horizontal' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
        const positive = direction === 'horizontal' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
        if (!negative && !positive) return
        event.preventDefault()
        onResize(negative ? -0.05 : 0.05)
      }}
      onPointerDown={(event) => {
        const parent = event.currentTarget.parentElement
        if (parent === null) return
        pointer.current = {
          coordinate: direction === 'horizontal' ? event.clientX : event.clientY,
          extent: direction === 'horizontal' ? parent.clientWidth : parent.clientHeight,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = pointer.current
        if (current === undefined || current.extent <= 0) return
        const coordinate = direction === 'horizontal' ? event.clientX : event.clientY
        queue((coordinate - current.coordinate) / current.extent)
        current.coordinate = coordinate
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  )
}

/** Render persistent app panels over a recursive, draggable split-group layout. */
export function SidePanelRoot({ useStore, actions, renderSlot, close, t }: SidePanelRootProps) {
  const selectedRoot = useStore(state => state.root)
  const root = selectedRoot ?? FALLBACK_ROOT
  const activePane = useStore(state => state.activePane) ?? FALLBACK_ROOT.id
  const panes = useMemo(() => leavesOf(root), [root])
  const locatedTabs = useMemo<LocatedTab[]>(
    () => panes.flatMap(pane => pane.tabs.map(tab => ({ pane, tab }))),
    [panes],
  )
  const closePane = topRightLeaf(root).id
  const workbench = useRef<HTMLDivElement>(null)
  const [paneRects, setPaneRects] = useState<Readonly<Record<string, PaneRect>>>({})
  const [launchpadPane, setLaunchpadPane] = useState<string | undefined>()
  const [dragged, setDragged] = useState<DraggedTab | undefined>()
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>()

  useEffect(() => {
    const clear = (): void => {
      setDragged(undefined)
      setDropTarget(undefined)
    }
    window.addEventListener('dragend', clear, true)
    window.addEventListener('drop', clear, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('dragend', clear, true)
      window.removeEventListener('drop', clear, true)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useLayoutEffect(() => {
    const host = workbench.current
    if (host === null) return
    let frame: number | undefined
    const measure = (): void => {
      frame = undefined
      const hostRect = host.getBoundingClientRect()
      const next: Record<string, PaneRect> = {}
      for (const element of host.querySelectorAll<HTMLElement>('[data-sidepanel-pane-content]')) {
        const paneId = element.dataset.sidepanelPaneContent
        if (paneId === undefined) continue
        const rect = element.getBoundingClientRect()
        next[paneId] = {
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        }
      }
      setPaneRects(current => sameRects(current, next) ? current : next)
    }
    const schedule = (): void => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(measure)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(schedule)
    observer.observe(host)
    for (const element of host.querySelectorAll<HTMLElement>('[data-sidepanel-pane-content]')) observer.observe(element)
    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [root])

  const requireActions = (): NonNullable<SidePanelRootProps['actions']> => {
    /* v8 ignore next 2 -- tab gestures render only after a session store exists */
    if (actions === undefined) throw new Error('sidepanel interaction without a store')
    return actions
  }

  const showLaunchpad = (pane: SidePanelLeaf): boolean =>
    pane.tabs.length === 0 || pane.active === null || launchpadPane === pane.id

  const activate = (paneId: string, tabId: string): void => {
    setLaunchpadPane(undefined)
    requireActions().setActive(paneId, tabId)
  }

  const closeTab = (paneId: string, tabId: string): void => {
    requireActions().closeTab(paneId, tabId)
  }

  const navigateTabs = (
    event: KeyboardEvent<HTMLButtonElement>,
    pane: SidePanelLeaf,
    index: number,
  ): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % pane.tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + pane.tabs.length) % pane.tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = pane.tabs.length - 1
    if (next === undefined) return
    event.preventDefault()
    const target = pane.tabs[next]
    if (target === undefined) return
    activate(pane.id, target.id)
    document.getElementById(tabElementId(target.id))?.focus()
  }

  const closeWithMiddleClick = (
    event: MouseEvent<HTMLButtonElement>, paneId: string, tabId: string,
  ): void => {
    if (event.button !== 1) return
    event.preventDefault()
    closeTab(paneId, tabId)
  }

  const dragSource = (event: DragEvent<HTMLElement>): DraggedTab | undefined => dragged ?? decodeDrag(event)

  const markDrop = (
    event: DragEvent<HTMLElement>, paneId: string, zone: SidePanelDropZone, beforeTabId?: string,
  ): void => {
    if (dragSource(event) === undefined) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const next: DropTarget = beforeTabId === undefined ? { paneId, zone } : { paneId, zone, beforeTabId }
    setDropTarget(current => current?.paneId === next.paneId
      && current.zone === next.zone
      && current.beforeTabId === next.beforeTabId
      ? current
      : next)
  }

  const drop = (
    event: DragEvent<HTMLElement>, paneId: string, zone: SidePanelDropZone, beforeTabId?: string,
  ): void => {
    const source = dragSource(event)
    if (source === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (!(source.paneId === paneId && source.tabId === beforeTabId)) {
      requireActions().moveTab(source.paneId, source.tabId, paneId, zone, beforeTabId)
    }
    setDragged(undefined)
    setDropTarget(undefined)
    setLaunchpadPane(undefined)
  }

  const surfaceDragOver = (event: DragEvent<HTMLElement>, paneId: string): void => {
    markDrop(event, paneId, zoneAt(event))
  }

  const surfaceDrop = (event: DragEvent<HTMLElement>, paneId: string): void => {
    drop(event, paneId, zoneAt(event))
  }

  const renderPane = (pane: SidePanelLeaf) => (
    <div
      key={pane.id}
      className={css.pane}
      data-sidepanel-pane={pane.id}
      data-active={activePane === pane.id || undefined}
      onPointerDown={() => { actions?.focusPane(pane.id) }}
    >
      <div className={css.header}>
        <div
          className={css.strip}
          role="tablist"
          onDragOver={(event) => { markDrop(event, pane.id, 'center') }}
          onDrop={(event) => { drop(event, pane.id, 'center') }}
        >
          {pane.tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={css.tab}
              data-active={tab.id === pane.active || undefined}
              data-drop={dropTarget?.paneId === pane.id && dropTarget.beforeTabId === tab.id || undefined}
              onDragOver={(event) => { markDrop(event, pane.id, 'center', tab.id) }}
              onDrop={(event) => { drop(event, pane.id, 'center', tab.id) }}
            >
              <button
                id={tabElementId(tab.id)}
                type="button"
                role="tab"
                draggable
                className={css.tabButton}
                aria-selected={tab.id === pane.active && !showLaunchpad(pane)}
                aria-controls={panelId(tab.id)}
                tabIndex={tab.id === pane.active ? 0 : -1}
                onClick={() => { activate(pane.id, tab.id) }}
                onAuxClick={(event) => { closeWithMiddleClick(event, pane.id, tab.id) }}
                onKeyDown={(event) => { navigateTabs(event, pane, index) }}
                onDragStart={(event) => {
                  const source = { paneId: pane.id, tabId: tab.id }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(source))
                  setDragged(source)
                  setDropTarget({ paneId: pane.id, zone: 'center' })
                }}
                onDragEnd={() => { setDragged(undefined); setDropTarget(undefined) }}
              >
                <span className={css.tabTitle}>{tab.title}</span>
              </button>
              <button
                type="button"
                className={css.tabClose}
                aria-label={t('panel.tab.close')}
                onClick={() => { closeTab(pane.id, tab.id) }}
              >
                <IconCloseFill14 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={css.addTab}
            aria-label={t('panel.tab.add')}
            aria-expanded={showLaunchpad(pane)}
            data-active={launchpadPane === pane.id || undefined}
            onClick={() => {
              actions?.focusPane(pane.id)
              setLaunchpadPane(current => current === pane.id && pane.tabs.length > 0 ? undefined : pane.id)
            }}
          >
            <IconPlusOutline16 size={13} />
          </button>
        </div>
        {closePane === pane.id ? (
          <button type="button" className={css.panelClose} aria-label={t('panel.close')} onClick={close}>
            <IconCloseOutline16 size={16} />
          </button>
        ) : null}
      </div>
      <div
        className={css.paneContent}
        data-sidepanel-pane-content={pane.id}
        onDragOver={(event) => { surfaceDragOver(event, pane.id) }}
        onDrop={(event) => { surfaceDrop(event, pane.id) }}
      />
    </div>
  )

  const renderNode = (node: SidePanelNode): ReactNode => {
    if (node.kind === 'leaf') return renderPane(node)
    return (
      <div key={node.id} className={css.split} data-direction={node.direction}>
        {node.children.map((child, index) => (
          <Fragment key={child.id}>
            <div className={css.splitChild} style={{ flexGrow: node.sizes[index] ?? 0.5 }}>
              {renderNode(child)}
            </div>
            {index < node.children.length - 1 ? (
              <SplitDivider
                direction={node.direction}
                label={t('panel.resize')}
                onResize={(delta) => { requireActions().resizeSplit(node.id, index, delta) }}
              />
            ) : null}
          </Fragment>
        ))}
      </div>
    )
  }
  const dropRect = dropTarget === undefined ? undefined : paneRects[dropTarget.paneId]

  return (
    <div ref={workbench} className={css.root}>
      <div className={css.layout}>{renderNode(root)}</div>
      <div className={css.appLayer}>
        {panes.map(pane => (
          <section
            key={`launchpad:${pane.id}`}
            className={css.launchpad}
            hidden={!showLaunchpad(pane)}
            aria-label={t('panel.launchpad')}
            style={appStyle(paneRects[pane.id])}
            onPointerDown={() => { actions?.focusPane(pane.id) }}
            onDragOver={(event) => { surfaceDragOver(event, pane.id) }}
            onDrop={(event) => { surfaceDrop(event, pane.id) }}
          >
            {renderSlot('sidepanel.launchpad', {
              open: actions === undefined
                ? (tab) => { void tab }
                : (tab) => { requireActions().openTab(tab, pane.id); setLaunchpadPane(undefined) },
            }, {
              fallback: <div className={css.empty}>{t('panel.launchpad.empty')}</div>,
            })}
          </section>
        ))}
        {locatedTabs.map(({ pane, tab }) => (
          <section
            key={tab.id}
            id={panelId(tab.id)}
            role="tabpanel"
            aria-labelledby={tabElementId(tab.id)}
            className={css.appPanel}
            data-app-id={tab.id}
            hidden={showLaunchpad(pane) || tab.id !== pane.active}
            style={appStyle(paneRects[pane.id])}
            onPointerDown={() => { actions?.focusPane(pane.id) }}
            onDragOver={(event) => { surfaceDragOver(event, pane.id) }}
            onDrop={(event) => { surfaceDrop(event, pane.id) }}
          >
            {renderSlot('sidepanel.app', {}, {
              entryKey: tab.id,
              fallback: <div className={css.empty}>{t('panel.appMissing')}</div>,
            })}
          </section>
        ))}
      </div>
      {dropTarget !== undefined && dropRect !== undefined ? (
        <div
          className={css.dropGuide}
          data-sidepanel-drop-guide=""
          style={dropRect}
          role="status"
          aria-live="polite"
          aria-label={dropLabel(t, dropTarget.zone)}
        >
          <div
            className={css.dropIndicator}
            data-zone={dropTarget.zone}
            style={overlayStyle(dropTarget.zone)}
            aria-hidden
          />
          <div className={css.dropCompass} aria-hidden>
            {DROP_ZONES.map(zone => (
              <span
                key={zone}
                className={css.dropZone}
                data-drop-zone={zone}
                data-active={dropTarget.zone === zone || undefined}
                title={dropLabel(t, zone)}
              >
                <DropZoneIcon zone={zone} />
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
