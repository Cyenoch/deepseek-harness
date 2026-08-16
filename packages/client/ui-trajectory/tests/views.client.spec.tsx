// @vitest-environment jsdom
/**
 * Registration acceptance on the real framework stack: the plugin fiber
 * registers the Trajectory as a side panel app (launchpad card + keyed tab
 * body) in a real SlotRegistry, the body renders the event ledger with its
 * timing overview under outlet-faithful session-maybe shares, and fiber
 * disposal removes both entries. Timeline projection and inclusive focus
 * edge cases ride along.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ComponentProps, type FC } from 'react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import {
  ConversationEventRegistry, ConversationViewRegistry, createSnapshotStore,
  EMPTY_CHAT_SNAPSHOT,
} from '@deepseek-ai/dsh-client-runtime/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RequestView,
  SessionId, SessionListState, SnapshotStore, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { LocaleKeysOf } from '@deepseek-ai/dsh-client-ui-slots'
import { zh, type TrajectoryKey } from '../src/client/locales.ts'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-trajectory'
import type { TrajectoryTurnModel } from '../src/client/layout.ts'
import { TrajectoryTimeline } from '../src/client/TrajectoryTimeline.tsx'
import {
  TrajectoryView, type TrajectoryViewInjected, type TrajectoryViewProps,
} from '../src/client/TrajectoryView.tsx'
import { TrajectoryLaunchCard, type TrajectoryLaunchCardProps } from '../src/client/TrajectoryLaunchCard.tsx'
import { createTrajectoryDurationStore } from '../src/client/duration-store.ts'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'
import { deriveTrajectoryTimeline } from '../src/client/timeline.ts'

const SID = 's1' as SessionId
const sessionSnapshots = new WeakMap<SlotRegistry, SnapshotStore<ConversationSnapshot>>()
afterEach(cleanup)
// The chat store persists under its declared key; clear so one case's active
// view cannot rehydrate into the next.
beforeEach(() => {
  localStorage.clear()
})

/** Node fixture: user prologue, two turns, one tool result inside turn 1. */
const NODES = [
  { kind: 'user', seq: 1, time: 1_000, content: [], source: null },
  {
    kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [],
    timing: { stepStartTime: 1_800, firstTokenTime: 1_900, completedTime: 2_000 },
  },
  {
    kind: 'tool-result', seq: 3, time: 3_000, callId: 'c1', call: null, callTime: 2_200,
    content: [], isError: false, callView: null, resultView: null,
  },
  {
    kind: 'assistant', seq: 4, time: 4_000, turn: 2, step: 1, blocks: [],
    timing: { stepStartTime: 3_500, firstTokenTime: 3_700, completedTime: 4_000 },
  },
] as unknown as ConversationSnapshot['nodes']

function historySnapshot(
  nodes: ConversationSnapshot['nodes'],
  inspection: Partial<TrajectorySnapshot> = {},
): ConversationSnapshot {
  const trajectory: TrajectorySnapshot = {
    eventNodes: nodes,
    eventLocations: new Map(),
    requests: [],
    callSchemas: new Map(),
    partial: null,
    runningCalls: [],
    ...inspection,
  }
  return {
    sessionId: SID,
    views: {
      get: target => target === 'trajectory' ? trajectory : undefined,
    },
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: trajectory.partial,
    runningCalls: trajectory.runningCalls,
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: nodes.length === 0,
    lastAgentError: null,
  }
}

function standaloneHistory(
  snapshot: ConversationSnapshot,
): Pick<
  ComponentProps<typeof TrajectoryView>,
  'useSession' | 'loadOlder'
> {
  const store = createSnapshotStore(snapshot)
  return {
    useSession: bindSnapshotSelector(store),
    loadOlder: () => Promise.resolve(false),
  }
}

function standaloneDuration(): Pick<
  ComponentProps<typeof TrajectoryView>, 'useDuration' | 'setActualDuration'
> {
  const duration = createSnapshotStore(false)
  return {
    useDuration: bindSnapshotSelector(duration),
    setActualDuration: (value) => { duration.set(value) },
  }
}

function fakeSession(nodes: ConversationSnapshot['nodes']) {
  const store = createSnapshotStore(historySnapshot(nodes))
  return { store, useSession: bindSnapshotSelector(store) }
}

/** Empty sessions-list hook; breadcrumbs therefore fall back to the raw id. */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}

function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
    recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

/** Standalone app props: the session-maybe standard kit the outlet would bake. */
function standaloneProps(
  nodes: ConversationSnapshot['nodes'],
): TrajectoryViewProps {
  return {
    sessionId: SID,
    useSession: fakeSession(nodes).useSession,
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useProjection: (() => undefined) as never,
    // The locale seat the outlet would inject for the declared namespace.
    t: (key: LocaleKeysOf<'trajectory'>) => zh[key as TrajectoryKey] ?? key,
  } as unknown as TrajectoryViewProps
}

/** Real-stack bench: root Context + real SlotRegistry ring + the plugin fiber. */
async function bench(snapshot = historySnapshot(NODES)) {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  const loadOlder = vi.fn(() => Promise.resolve())
  const sessionStore = createSnapshotStore(snapshot)
  const session = {
    getSnapshot: () => sessionStore.getSnapshot(),
    subscribe: (listener: () => void) => sessionStore.subscribe(listener),
    loadOlder,
  }
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  ctx.provide('sessions', {
    binding: () => ({ session }),
  })
  sessionSnapshots.set(slots, sessionStore)
  // The side panel shell's role: declare both app seats the plugin targets.
  slots.register({
    name: 'root',
    children: {
      'sidepanel.app': { kind: 'keyed', scope: 'session-maybe' },
      'sidepanel.launchpad': { kind: 'list', scope: 'session-maybe' },
    },
  }, (_p: { renderSlot?: unknown }) => null)
  // The locale plugin backs the locale-aware view tab label ('locale' in
  // inject); its settings scope needs a connection handle and the
  // forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.plugin({ inject: [...localeInject], apply: localeApply })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, fiber, loadOlder, sessionStore }
}

/** The trajectory's keyed entry on the side panel app seat. */
function appEntryOf(slots: SlotRegistry) {
  const entry = slots.entries('sidepanel.app').find(e => e.options.key === 'trajectory')
  if (entry === undefined) throw new Error('sidepanel.app entry "trajectory" missing')
  return entry
}

/** Mount the trajectory app body with outlet-faithful session-maybe shares. */
function mount(slots: SlotRegistry, nodes: ConversationSnapshot['nodes'] = NODES) {
  const sessionSnapshot = sessionSnapshots.get(slots) ?? createSnapshotStore(historySnapshot(nodes))
  const useSession = bindSnapshotSelector(sessionSnapshot)
  const entry = appEntryOf(slots)
  // Minimal outlet twin: the keyed seat dispatches by key and hands the
  // component its inject face plus the session-maybe standard kit (what
  // SlotOutlet does for a keyed session-maybe slot, minus machinery).
  const App = entry.component as FC<TrajectoryViewProps>
  const injectEntry = entry.inject as unknown as (sessionId: SessionId | undefined) => TrajectoryViewInjected
  const injected = injectEntry(SID)
  const props = {
    loadOlder: injected.loadOlder,
    setActualDuration: injected.setActualDuration,
    useDuration: bindSnapshotSelector(injected.hooks.duration),
    t: (key: TrajectoryKey) => zh[key],
    sessionId: SID,
    useSession,
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
  } as unknown as TrajectoryViewProps
  return render(<App {...props} />)
}

describe('plugin registration', () => {
  it('registers the trajectory app on the side panel seats', async () => {
    const b = await bench()
    expect(b.slots.entries('sidepanel.app').map(e => e.options.key)).toEqual(['trajectory'])
    expect(b.slots.entries('sidepanel.launchpad').map(e => e.options.id)).toEqual(['trajectory'])
    // The conversation view ring is untouched: the plugin left it entirely.
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
  })

  it('fiber disposal removes both entries and the definitions', async () => {
    const b = await bench()
    const events = b.ctx.get('conversationEvents') as ConversationEventRegistry
    const views = b.ctx.get('conversationViews') as ConversationViewRegistry
    expect(events.entries().length).toBeGreaterThan(0)
    expect(views.entries()).toHaveLength(1)

    await b.fiber.dispose()

    expect(b.slots.entries('sidepanel.app')).toHaveLength(0)
    expect(b.slots.entries('sidepanel.launchpad')).toHaveLength(0)
    expect(events.entries()).toEqual([])
    expect(views.entries()).toEqual([])
  })

  it('shares one browser-wide duration preference across session injections', async () => {
    const b = await bench()
    const injectEntry = appEntryOf(b.slots).inject as unknown as (
      sessionId: SessionId | undefined,
    ) => TrajectoryViewInjected
    const first = injectEntry(SID)
    const second = injectEntry('s2' as SessionId)

    expect(second.hooks.duration).toBe(first.hooks.duration)
    first.setActualDuration(true)
    expect(second.hooks.duration.getSnapshot()).toBe(true)
    expect(localStorage.getItem('dsh.trajectory.duration')).toBe('true')
    expect(localStorage.getItem(`dsh.trajectory.duration.${SID}`)).toBeNull()
  })

  it('reports whether loading older history changed the Trajectory snapshot', async () => {
    const b = await bench()
    const injectEntry = appEntryOf(b.slots).inject as unknown as (
      sessionId: SessionId | undefined,
    ) => TrajectoryViewInjected
    const injected = injectEntry(SID)

    expect(await injected.loadOlder()).toBe(false)

    b.loadOlder.mockImplementationOnce(async () => {
      b.sessionStore.set(historySnapshot([...NODES]))
    })
    expect(await injected.loadOlder()).toBe(true)
  })

  it('the no-session inject face settles loadOlder without a binding', async () => {
    const b = await bench()
    const injectEntry = appEntryOf(b.slots).inject as unknown as (
      sessionId: SessionId | undefined,
    ) => TrajectoryViewInjected
    await expect(injectEntry(undefined).loadOlder()).resolves.toBe(false)
    expect(b.loadOlder).not.toHaveBeenCalled()
  })
})

describe('the side panel app body', () => {
  it('renders the trajectory ledger with its timing overview', async () => {
    const b = await bench()
    const view = mount(b.slots)
    expect(screen.queryByText(/turns ·/)).toBeNull()
    expect(view.container.querySelectorAll('tr[data-turn-start="true"]')).toHaveLength(2)
    expect(screen.queryByRole('columnheader')).toBeNull()
    expect(screen.getByRole('toolbar', { name: '轨迹工具栏' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Trajectory timeline' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse turns' }))
    expect(view.container.querySelector('[data-collapsed-summary="turn"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand turns' }))
    expect(screen.getByRole('row', { name: /USER/ })).toBeTruthy()
    expect(b.loadOlder).not.toHaveBeenCalled()
  })

  it('renders the no-session notice while no session is current', async () => {
    await bench()
    const useSession = ((_sel: (s: ConversationSnapshot) => unknown) => undefined) as never
    const props = {
      t: (key: TrajectoryKey) => zh[key],
      sessionId: undefined,
      useSession,
      useSessions: emptySessions(),
      useWorkspaces: emptyWorkspaces(),
      useDuration: bindSnapshotSelector(createTrajectoryDurationStore()),
      loadOlder: async () => false,
      setActualDuration: () => {},
    } as unknown as TrajectoryViewProps
    const view = render(<TrajectoryView {...props} />)
    expect(view.container.textContent).toContain(zh['sidepanel.noSession'])
  })

  it('the launchpad card opens the tab titled in the active locale', async () => {
    const b = await bench()
    const locale = b.ctx.get('locale') as unknown as {
      setLocale(id: string): void
      bind: (ns: string) => (key: string) => string
    }
    locale.setLocale('en')
    const open = vi.fn()
    const tEn = locale.bind('trajectory')
    const cardEn = { open, t: tEn, useSessions: emptySessions(), useWorkspaces: emptyWorkspaces() } as never as TrajectoryLaunchCardProps
    const card = render(<TrajectoryLaunchCard {...cardEn} />)
    fireEvent.click(card.container.querySelector('button')!)
    expect(open).toHaveBeenCalledWith({ id: 'trajectory', title: 'Trajectory' })
    expect(card.getByText('Trajectory')).toBeTruthy()

    locale.setLocale('zh')
    const tZh = locale.bind('trajectory')
    const cardZhProps = {
      open, t: tZh, useSessions: emptySessions(), useWorkspaces: emptyWorkspaces(),
    } as never as TrajectoryLaunchCardProps
    const cardZh = render(<TrajectoryLaunchCard {...cardZhProps} />)
    fireEvent.click(cardZh.container.querySelector('button')!)
    expect(open).toHaveBeenLastCalledWith({ id: 'trajectory', title: '轨迹' })
  })

  it('opens a local record inspector and switches payload tabs without opening chat details', async () => {
    const b = await bench()
    mount(b.slots)

    fireEvent.keyDown(screen.getByRole('row', { name: /TOOL/ }), { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: 'Event details' })).toBeTruthy()
    expect(screen.getByText('Turn 1 · Step 1')).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Result' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('complementary', { name: 'Event details' })).toBeNull()
  })

  it('labels a standalone compaction as between-turn work in the ledger and inspector', async () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [], source: null },
      {
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'before' }],
      },
      { kind: 'user', seq: 5, time: 5_000, content: [], source: null },
      {
        kind: 'assistant', seq: 6, time: 6_000, turn: 2, step: 1,
        blocks: [{ kind: 'text', text: 'after' }],
      },
    ] as unknown as ConversationSnapshot['nodes']
    const compaction: RequestView = {
      purpose: 'compaction',
      startSeq: 3,
      turn: null,
      step: 0,
      startedAt: 3_000,
      completedAt: 4_000,
      status: 'complete',
      summary: [{ type: 'text', text: 'standalone summary' }],
    }
    const b = await bench(historySnapshot(nodes, { requests: [compaction] }))
    const view = mount(b.slots, nodes)

    expect(screen.getByText('Between turns')).toBeTruthy()
    expect(view.container.textContent).not.toContain('Turn null')

    fireEvent.click(screen.getByRole('button', { name: 'Request #2 · Compaction' }))
    expect(screen.getByText('Compaction · Between turns')).toBeTruthy()
    expect(view.container.textContent).not.toContain('Turn null')
  })

  it('activates only the selected standalone compaction section', async () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [], source: null },
      {
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'before first compaction' }],
      },
      { kind: 'user', seq: 5, time: 5_000, content: [], source: null },
      {
        kind: 'assistant', seq: 6, time: 6_000, turn: 2, step: 1,
        blocks: [{ kind: 'text', text: 'between compactions' }],
      },
      { kind: 'user', seq: 9, time: 9_000, content: [], source: null },
      {
        kind: 'assistant', seq: 10, time: 10_000, turn: 3, step: 1,
        blocks: [{ kind: 'text', text: 'after second compaction' }],
      },
    ] as unknown as ConversationSnapshot['nodes']
    const compactions: RequestView[] = [
      {
        purpose: 'compaction',
        startSeq: 3,
        turn: null,
        step: 0,
        startedAt: 3_000,
        completedAt: 4_000,
        status: 'complete',
        summary: [{ type: 'text', text: 'first standalone summary' }],
      },
      {
        purpose: 'compaction',
        startSeq: 7,
        turn: null,
        step: 0,
        startedAt: 7_000,
        completedAt: 8_000,
        status: 'complete',
        summary: [{ type: 'text', text: 'second standalone summary' }],
      },
    ]
    const b = await bench(historySnapshot(nodes, { requests: compactions }))
    mount(b.slots, nodes)

    const firstRequest = screen.getByRole('button', { name: 'Request #2 · Compaction' })
    const secondRequest = screen.getByRole('button', { name: 'Request #4 · Compaction' })
    const firstSection = firstRequest.closest('tr')?.querySelector('span')
    const secondSection = secondRequest.closest('tr')?.querySelector('span')
    expect(firstSection?.textContent).toBe('Between turns')
    expect(secondSection?.textContent).toBe('Between turns')

    fireEvent.click(firstRequest)
    expect(firstSection?.className).toMatch(/turnLabelActive/)
    expect(secondSection?.className).not.toMatch(/turnLabelActive/)
    expect(screen.getByText('Request #2')).toBeTruthy()
    expect(screen.getByText('Compaction · Between turns')).toBeTruthy()

    fireEvent.click(secondRequest)
    expect(firstSection?.className).not.toMatch(/turnLabelActive/)
    expect(secondSection?.className).toMatch(/turnLabelActive/)
    expect(screen.getByText('Request #4')).toBeTruthy()
    expect(screen.getByText('Compaction · Between turns')).toBeTruthy()
  })

  it('dragging the overview focuses overlapping records without filtering the ledger', async () => {
    const b = await bench()
    mount(b.slots)
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(plot, { button: 0, clientX: 55, pointerId: 1 })
    fireEvent.pointerMove(plot, { clientX: 95, pointerId: 1 })
    fireEvent.pointerUp(plot, { clientX: 95, pointerId: 1 })

    expect(screen.getByRole('row', { name: /USER/ }).getAttribute('data-timeline-focus'))
      .toBe('outside')

    const tablePane = screen.getByRole('table').parentElement
    expect(tablePane).not.toBeNull()
    fireEvent.click(tablePane as HTMLElement)
    expect(screen.getByRole('row', { name: /USER/ }).getAttribute('data-timeline-focus'))
      .toBeNull()

    fireEvent.pointerDown(plot, { button: 0, clientX: 55, pointerId: 2 })
    fireEvent.pointerMove(plot, { clientX: 95, pointerId: 2 })
    fireEvent.pointerUp(plot, { clientX: 95, pointerId: 2 })
    expect(screen.getByRole('row', { name: /USER/ }).getAttribute('data-timeline-focus'))
      .toBe('outside')
    fireEvent.contextMenu(plot)
    expect(screen.getByRole('row', { name: /USER/ }).getAttribute('data-timeline-focus'))
      .toBe('outside')
  })

  it('clicking a timeline block clears the range, selects the record, and opens its inspector', async () => {
    const b = await bench()
    const view = mount(b.slots)
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    const toolSpan = view.container.querySelector<HTMLElement>(
      '[data-timeline-span="tool"]',
    )
    expect(toolSpan).not.toBeNull()
    const recordIndex = toolSpan?.dataset.timelineRecordIndex
    expect(recordIndex).toBeTruthy()

    fireEvent.pointerMove(toolSpan as HTMLElement, { clientX: 50, pointerId: 1 })
    expect(view.container.querySelector('[data-timeline-hover-line]')).toBeNull()
    expect(toolSpan?.getAttribute('data-hovered')).toBe('true')

    fireEvent.pointerDown(plot, { button: 0, clientX: 5, pointerId: 1 })
    fireEvent.pointerMove(plot, { clientX: 95, pointerId: 1 })
    fireEvent.pointerUp(plot, { clientX: 95, pointerId: 1 })
    expect(view.container.querySelector('tr[data-timeline-focus]')).toBeTruthy()

    fireEvent.pointerDown(toolSpan as HTMLElement, {
      button: 0, clientX: 50, pointerId: 2,
    })
    fireEvent.pointerUp(toolSpan as HTMLElement, { clientX: 50, pointerId: 2 })

    const selectedRow = view.container.querySelector<HTMLElement>(
      `tr[data-record-index="${recordIndex}"]`,
    )
    expect(selectedRow?.getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelector('tr[data-timeline-focus]')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Event details' })).toBeTruthy()
  })

  it('empty window keeps the toolbar and reports no timing data', async () => {
    const b = await bench(historySnapshot([]))
    mount(b.slots)
    expect(screen.getByRole('toolbar', { name: '轨迹工具栏' })).toBeTruthy()
    expect(screen.getByText('No timing data')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', {
      name: 'Collapse turns',
    }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', {
      name: 'Collapse calls',
    }).disabled).toBe(false)
    expect(screen.queryByRole('row')).toBeNull()
    expect(screen.queryByText(/turns ·/)).toBeNull()
  })
})

describe('timeline projection', () => {
  const turns = [{
    turn: 1,
    groups: [{
      title: 'Step 1',
      cells: [
        { index: 1, kind: 'message', text: 'assistant', startedAt: 1_000, timeSeconds: 1 },
        { index: 2, kind: 'tool', text: 'bash', startedAt: 2_000, timeSeconds: 1 },
        { index: 3, kind: 'user', text: 'unknown', timeSeconds: 0 },
      ],
    }],
  }] satisfies readonly TrajectoryTurnModel[]
  const longTurns = [{
    turn: 1,
    groups: [{
      title: 'Step 1',
      cells: Array.from({ length: 10 }, (_, index) => ({
        index,
        kind: 'message' as const,
        text: `record ${index}`,
        timeSeconds: 1,
      })),
    }],
  }] satisfies readonly TrajectoryTurnModel[]

  it('splits assistant time into recorded TTFT and decoding proportions with a delayed tooltip', () => {
    vi.useFakeTimers()
    try {
      const view = render(
        <TrajectoryTimeline
          turns={[{
            turn: 1,
            groups: [{
              title: 'Step 1',
              cells: [{
                index: 1,
                kind: 'message',
                text: 'assistant',
                startedAt: 1_000,
                timeSeconds: 2,
                assistantMetrics: {
                  timingRecorded: true,
                  stepStartTime: 1_000,
                  firstTokenTime: 1_500,
                  completedTime: 3_000,
                  usageProvided: false,
                  outputTokens: null,
                },
              }],
            }],
          }]}
          mode="duration"
          range={null}
          onRangeChange={vi.fn()}
        />,
      )
      const span = view.container.querySelector<HTMLElement>(
        '[data-timeline-span="message"]',
      )
      expect(span?.getAttribute('title')).toBeNull()
      expect(span?.getAttribute('data-assistant-timing')).toBe('true')
      expect(span?.style.getPropertyValue('--trajectory-assistant-ttft')).toBe('25%')

      fireEvent.mouseEnter(span as HTMLElement)
      act(() => { vi.advanceTimersByTime(499) })
      expect(view.container.querySelector('[role="tooltip"]')).toBeNull()
      act(() => { vi.advanceTimersByTime(1) })
      const tooltip = view.container.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.textContent).toContain('Total 2,000 ms')
      expect(tooltip?.textContent).toContain('TTFT 500 ms')
      expect(tooltip?.textContent).toContain('Decoding 1,500 ms')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks an unloaded history prefix without inventing timeline duration', () => {
    const onLoadEarlier = vi.fn(() => new Promise<boolean>(() => {}))
    const view = render(
      <TrajectoryTimeline
        turns={turns}
        mode="sequence"
        range={null}
        hasEarlierRecords
        onLoadEarlier={onLoadEarlier}
        onRangeChange={vi.fn()}
      />,
    )

    const boundary = screen.getByLabelText('Load earlier history')
    expect(boundary.getAttribute('data-earlier-history')).not.toBeNull()
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    fireEvent.pointerMove(plot, { clientX: 50, pointerId: 1 })
    expect(view.container.querySelector('[data-timeline-hover-line]')).toBeTruthy()
    fireEvent.pointerEnter(boundary)
    expect(view.container.querySelector('[data-timeline-hover-line]')).toBeNull()
    fireEvent.focus(boundary)
    expect(screen.getByRole('tooltip').textContent)
      .toContain('Click to load earlier history')
    fireEvent.click(boundary)
    expect(onLoadEarlier).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Loading earlier history')).toBeTruthy()

    view.rerender(
      <TrajectoryTimeline
        turns={turns}
        mode="sequence"
        range={null}
        onRangeChange={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Load earlier history')).toBeNull()
    expect(screen.queryByLabelText('Loading earlier history')).toBeNull()
  })

  it('cancels native scrolling across the timeline while zooming', () => {
    render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        onRangeChange={vi.fn()}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 44, y: 0, left: 44, top: 0, right: 144, bottom: 50, width: 100, height: 50,
      toJSON: () => ({}),
    })

    expect(fireEvent.wheel(plot, { clientX: 94, deltaY: -100 })).toBe(false)
    expect(fireEvent.wheel(screen.getByText('Input'), {
      clientX: 20,
      deltaY: -100,
    })).toBe(false)
  })

  it('scales sequence gutters with narrow operation spans', () => {
    const view = render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        onRangeChange={vi.fn()}
      />,
    )
    const span = view.container.querySelector<HTMLElement>('[data-timeline-span]')
    expect(span?.style.getPropertyValue('--trajectory-span-width')).toBe('10%')
    expect(span?.style.getPropertyValue('--trajectory-span-gap'))
      .toBe('min(0.8%, 1px)')
  })

  it('keeps dense sequence spans proportional before applying the pixel floor', () => {
    const denseTurns = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: Array.from({ length: 400 }, (_, index) => ({
          index,
          kind: 'message' as const,
          text: `message ${index}`,
          timeSeconds: 1,
        })),
      }],
    }]
    const view = render(
      <TrajectoryTimeline
        turns={denseTurns}
        mode="sequence"
        range={null}
        onRangeChange={vi.fn()}
      />,
    )

    const span = view.container.querySelector<HTMLElement>('[data-timeline-span]')
    expect(span?.style.getPropertyValue('--trajectory-span-width')).toBe('0.25%')
    expect(span?.style.getPropertyValue('--trajectory-span-gap'))
      .toBe('min(0.02%, 1px)')
  })

  it('clears the selection without changing zoom on a zoomed right click', () => {
    const onRangeChange = vi.fn()
    const view = render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={{ start: 2, end: 4 }}
        hasEarlierRecords
        onRangeChange={onRangeChange}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    expect(screen.getByLabelText('Load earlier history')).toBeTruthy()
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    fireEvent.wheel(plot, { clientX: 50, deltaY: -1_000 })
    expect(screen.queryByLabelText('Load earlier history')).toBeNull()
    const domain = view.container.querySelector<HTMLElement>('[data-timeline-domain]')
    const domainWidth = domain?.style.getPropertyValue('--trajectory-domain-width')
    expect(domainWidth).not.toBe('100%')

    fireEvent.pointerDown(plot, { button: 2, clientX: 50, pointerId: 1 })
    expect(fireEvent.contextMenu(plot)).toBe(false)
    fireEvent.pointerUp(plot, { button: 2, clientX: 50, pointerId: 1 })

    expect(onRangeChange).toHaveBeenCalledOnce()
    expect(onRangeChange).toHaveBeenCalledWith(null)
    expect(domain?.style.getPropertyValue('--trajectory-domain-width')).toBe(domainWidth)
  })

  it('clears the selection and suppresses the context menu at full zoom', () => {
    const onRangeChange = vi.fn()
    render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={{ start: 2, end: 4 }}
        onRangeChange={onRangeChange}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')

    fireEvent.pointerDown(plot, { button: 2, clientX: 50, pointerId: 1 })
    expect(fireEvent.contextMenu(plot)).toBe(false)
    fireEvent.pointerUp(plot, { button: 2, clientX: 50, pointerId: 1 })
    expect(onRangeChange).toHaveBeenCalledOnce()
    expect(onRangeChange).toHaveBeenCalledWith(null)
  })

  it('pans the zoomed viewport with a right-button drag without changing the selection', () => {
    const onRangeChange = vi.fn()
    const view = render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={{ start: 2, end: 4 }}
        onRangeChange={onRangeChange}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    fireEvent.wheel(plot, { clientX: 50, deltaY: -1_000 })
    const domain = view.container.querySelector<HTMLElement>('[data-timeline-domain]')
    const before = domain?.style.getPropertyValue('--trajectory-domain-left')

    fireEvent.pointerDown(plot, { button: 2, clientX: 50, pointerId: 1 })
    expect(plot.getAttribute('data-panning')).toBe('true')
    expect(fireEvent.contextMenu(plot)).toBe(false)
    fireEvent.pointerMove(plot, { buttons: 2, clientX: 75, pointerId: 1 })
    fireEvent.pointerUp(plot, { button: 2, clientX: 75, pointerId: 1 })

    expect(domain?.style.getPropertyValue('--trajectory-domain-left')).not.toBe(before)
    expect(onRangeChange).not.toHaveBeenCalled()
    expect(plot.getAttribute('data-panning')).toBeNull()
  })

  it('pans the zoomed viewport only far enough to reveal a newly selected record', async () => {
    const onRangeChange = vi.fn()
    const view = render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        onRangeChange={onRangeChange}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    fireEvent.wheel(plot, { clientX: 50, deltaY: -1_000 })

    view.rerender(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        selectedIndex={1}
        onRangeChange={onRangeChange}
      />,
    )
    await vi.waitFor(() => {
      const domain = view.container.querySelector<HTMLElement>(
        '[data-timeline-domain]',
      )
      expect(domain?.style.getPropertyValue('--trajectory-domain-left')).toBe('-25%')
    })

    view.rerender(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        selectedIndex={8}
        onRangeChange={onRangeChange}
      />,
    )
    await vi.waitFor(() => {
      const domain = view.container.querySelector<HTMLElement>(
        '[data-timeline-domain]',
      )
      expect(domain?.style.getPropertyValue('--trajectory-domain-left')).toBe('-125%')
    })
  })

  it('auto-pans a zoomed viewport while a range drag pushes against an edge', () => {
    const onRangeChange = vi.fn()
    const view = render(
      <TrajectoryTimeline
        turns={longTurns}
        mode="sequence"
        range={null}
        onRangeChange={onRangeChange}
      />,
    )
    const plot = screen.getByLabelText('Timeline overview; drag horizontally to focus events')
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72,
      toJSON: () => ({}),
    })
    fireEvent.wheel(plot, { clientX: 50, deltaY: -1_000 })
    fireEvent.pointerDown(plot, { button: 0, clientX: 50, pointerId: 1 })
    for (let index = 0; index < 24; index++) {
      fireEvent.pointerMove(plot, { clientX: 99, pointerId: 1 })
    }
    const draftSelection = view.container.querySelectorAll<HTMLElement>(
      '[data-dragging="true"]',
    )
    expect(draftSelection).toHaveLength(2)
    for (const overlay of draftSelection) {
      expect(Number.parseFloat(
        overlay.style.getPropertyValue('--trajectory-selection-left'),
      )).toBeLessThan(0)
    }
    fireEvent.pointerUp(plot, { clientX: 99, pointerId: 1 })

    const selectedRange = onRangeChange.mock.calls.at(-1)?.[0] as
      | { start: number; end: number }
      | undefined
    const fullRange = deriveTrajectoryTimeline(longTurns)
    expect(selectedRange).toBeDefined()
    expect(fullRange).not.toBeNull()
    expect((selectedRange?.end ?? 0) - (selectedRange?.start ?? 0)).toBeGreaterThan(4)
    expect(selectedRange?.start).toBeGreaterThanOrEqual(fullRange?.start ?? 0)
    expect(selectedRange?.end).toBeLessThanOrEqual(fullRange?.end ?? 0)
  })

  it('uses equal-width operation slots and stable semantic lanes', () => {
    expect(deriveTrajectoryTimeline(turns)).toEqual({
      start: 0,
      end: 3,
      spans: [
        {
          index: 1, isError: false, kind: 'message', label: 'assistant',
          lane: 1, start: 0, end: 1,
        },
        {
          index: 2, isError: false, kind: 'tool', label: 'bash',
          lane: 2, start: 1, end: 2,
        },
        {
          index: 3, isError: false, kind: 'user', label: 'unknown',
          lane: 0, start: 2, end: 3,
        },
      ],
      turnBoundaries: [{ turn: 1, time: 0 }],
    })
  })

  it('marks error records directly on timeline spans', () => {
    const errorTurns = [{
      turn: 1,
      groups: [{
        title: 'Step 1',
        cells: [{
          index: 1,
          kind: 'tool' as const,
          text: 'failed tool',
          timeSeconds: 0.1,
          isError: true,
        }],
      }],
    }] satisfies readonly TrajectoryTurnModel[]
    const view = render(
      <TrajectoryTimeline
        turns={errorTurns}
        mode="sequence"
        range={null}
        onRangeChange={() => {}}
      />,
    )

    expect(view.container.querySelector(
      '[data-timeline-span="tool"][data-error="true"]',
    )).toBeTruthy()
  })

  it('ignores durations and idle gaps while retaining turn boundaries', () => {
    const separatedTurns = [
      {
        turn: 1,
        groups: [{
          title: 'Step 1',
          cells: [
            { index: 1, kind: 'message', text: 'first', startedAt: 1_000, timeSeconds: 1 },
            { index: 2, kind: 'tool', text: 'within-turn gap', startedAt: 4_000, timeSeconds: 1 },
          ],
        }],
      },
      {
        turn: 2,
        groups: [{
          title: 'Step 1',
          cells: [
            { index: 3, kind: 'message', text: 'after user idle', startedAt: 40_000, timeSeconds: 1 },
          ],
        }],
      },
    ] satisfies readonly TrajectoryTurnModel[]

    expect(deriveTrajectoryTimeline(separatedTurns)).toMatchObject({
      start: 0,
      end: 3,
      spans: [
        { index: 1, start: 0, end: 1 },
        { index: 2, start: 1, end: 2 },
        { index: 3, start: 2, end: 3 },
      ],
      turnBoundaries: [
        { turn: 1, time: 0 },
        { turn: 2, time: 2 },
      ],
    })
  })

  it('compresses every idle gap in duration mode while actual mode retains wall time', () => {
    const separatedTurns = [
      {
        turn: 1,
        groups: [{
          title: 'Step 1',
          cells: [
            { index: 1, kind: 'message', text: 'first', startedAt: 1_000, timeSeconds: 1 },
            { index: 2, kind: 'tool', text: 'within-turn gap', startedAt: 4_000, timeSeconds: 1 },
          ],
        }],
      },
      {
        turn: 2,
        groups: [{
          title: 'Step 1',
          cells: [
            { index: 3, kind: 'message', text: 'after user idle', startedAt: 40_000, timeSeconds: 1 },
          ],
        }],
      },
    ] satisfies readonly TrajectoryTurnModel[]

    expect(deriveTrajectoryTimeline(separatedTurns, 'duration')).toMatchObject({
      start: 1_000,
      end: 4_000,
      spans: [
        { index: 1, start: 1_000, end: 2_000 },
        { index: 2, start: 2_000, end: 3_000 },
        { index: 3, start: 3_000, end: 4_000 },
      ],
      turnBoundaries: [
        { turn: 1, time: 1_000 },
        { turn: 2, time: 3_000 },
      ],
    })
    expect(deriveTrajectoryTimeline(separatedTurns, 'actual')).toMatchObject({
      start: 1_000,
      end: 41_000,
      spans: [
        { index: 1, start: 1_000, end: 2_000 },
        { index: 2, start: 4_000, end: 5_000 },
        { index: 3, start: 40_000, end: 41_000 },
      ],
    })
  })

  it('projects between-turn compaction without inventing a turn boundary', () => {
    const withStandaloneCompaction = [
      {
        turn: 1,
        groups: [{
          title: 'Step 1',
          cells: [{ index: 1, kind: 'message', text: 'before', timeSeconds: 0 }],
        }],
      },
      {
        turn: null,
        groups: [{
          title: 'Compaction 3',
          cells: [{ index: 2, kind: 'compacted', text: 'summary', timeSeconds: 0 }],
        }],
      },
      {
        turn: 2,
        groups: [{
          title: 'Step 1',
          cells: [{ index: 3, kind: 'message', text: 'after', timeSeconds: 0 }],
        }],
      },
    ] satisfies readonly TrajectoryTurnModel[]

    expect(deriveTrajectoryTimeline(withStandaloneCompaction)).toMatchObject({
      spans: [
        { index: 1, start: 0, end: 1 },
        { index: 2, start: 1, end: 2 },
        { index: 3, start: 2, end: 3 },
      ],
      turnBoundaries: [
        { turn: 1, time: 0 },
        { turn: 2, time: 2 },
      ],
    })
  })

  it('empty inputs produce no model and the standalone view reports its empty form', () => {
    expect(deriveTrajectoryTimeline([])).toBeNull()
    render(createElement(
      TrajectoryView,
      {
        ...standaloneProps([]),
        ...standaloneHistory(historySnapshot([])),
        ...standaloneDuration(),
      },
    ))
    expect(screen.getByRole('toolbar', { name: '轨迹工具栏' })).toBeTruthy()
    expect(screen.queryByRole('row')).toBeNull()
  })
})

describe('TrajectoryView state', () => {
  it('persists the duration preference through the runtime snapshot-store seam', () => {
    const firstDuration = createTrajectoryDurationStore()
    const commonProps = {
      ...standaloneProps(NODES),
      ...standaloneHistory(historySnapshot(NODES)),
    }
    const first = render(
      <TrajectoryView
        {...commonProps}
        useDuration={bindSnapshotSelector(firstDuration)}
        setActualDuration={(value) => { firstDuration.set(value) }}
      />,
    )
    const duration = screen.getByRole('button', { name: 'Use actual duration' })

    expect(duration.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(duration)
    expect(localStorage.getItem('dsh.trajectory.duration')).toBe('true')
    first.unmount()

    const restoredDuration = createTrajectoryDurationStore()
    render(
      <TrajectoryView
        {...commonProps}
        useDuration={bindSnapshotSelector(restoredDuration)}
        setActualDuration={(value) => { restoredDuration.set(value) }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Use actual duration' }).getAttribute('aria-pressed'))
      .toBe('true')
  })



  it('keeps ledger and timeline selection on the same event after prepend', () => {
    const older = {
      kind: 'user', seq: 1, time: 1_000,
      content: [{ type: 'text', text: 'older prompt' }], source: null,
    } as unknown as ConversationSnapshot['nodes'][number]
    const current = {
      kind: 'assistant', seq: 100, time: 5_000, turn: 2, step: 1,
      blocks: [{ kind: 'text', text: 'selected current response' }],
    } as unknown as ConversationSnapshot['nodes'][number]
    const store = createSnapshotStore(historySnapshot([current]))
    const view = render(
      <TrajectoryView
        {...standaloneProps([])}
        {...standaloneDuration()}
        useSession={bindSnapshotSelector(store)}
        loadOlder={vi.fn(() => Promise.resolve(false))}
      />,
    )
    fireEvent.click(screen.getByRole('row', { name: /selected current response/ }))

    act(() => { store.set(historySnapshot([older, current])) })

    const row = screen.getByRole('row', { name: /selected current response/ })
    expect(row.getAttribute('aria-selected')).toBe('true')
    const currentIndex = row.getAttribute('data-record-index')
    expect(view.container.querySelector(
      `[data-timeline-record-index="${currentIndex}"][data-current="true"]`,
    )).toBeTruthy()
  })

})

describe('node half', () => {
  it('node apply is an intentional no-op (loader-managed lifecycle only)', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
