import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandBtw from '@deepseek-ai/dsh-command-btw'
import { MockAdapter, maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const ADVISOR = 'You are a read-only side advisor; answer only the side question.'

type Script = ConstructorParameters<typeof MockAdapter>[0]

interface Harness {
  readonly ctx: Context
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
  readonly adapter: MockAdapter
  readonly parent: Agent
}

/**
 * Live composition: the real command registry, agent loop, and a scripted
 * adapter, with the parent created through the loop factory exactly as an
 * application spine does.
 */
async function setup(script: Script): Promise<Harness> {
  return setupWithAdapters([{ providers: ['mock'], adapter: new MockAdapter(script) }])
}

/** Same composition with several named adapters, for route-switching cases. */
async function setupWithAdapters(
  routes: readonly { providers: string[]; adapter: MockAdapter }[],
): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentLoop, { agents: [] })
  const plugin = await ctx.plugin(commandBtw, { advisor: ADVISOR })
  for (const route of routes) ctx.llm.registerAdapter(route.providers, route.adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, plugin, adapter: routes[0]!.adapter, parent }
}

/** Run one real parent turn so a later fork has a completed-turn prefix. */
async function parentTurnOne(test: Harness): Promise<number> {
  test.parent.followup(createUserMessage({
    content: [{ type: 'text', text: 'parent q1' }],
    source: { kind: 'user' },
  }))
  await test.parent.whenIdle()
  return test.parent.session.events.length
}

/** Collect child agents created during an execution through the lifecycle event. */
function collectChildren(ctx: Context, parentSessionId: SessionId): Agent[] {
  const children: Agent[] = []
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== undefined
      && String(agent.session.header.parentSession) === String(parentSessionId)) {
      children.push(agent)
    }
  })
  return children
}

/** Text of the last assistant message in a session. */
function lastAssistantText(test: Harness): string {
  const last = test.parent.session.events.findLast(event => event.type === 'assistant/message')
  if (last?.type !== 'assistant/message') return ''
  return last.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('@deepseek-ai/dsh-command-btw registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await setup([])
    expect(commandBtw.name).toBe('command-btw')
    expect(commandBtw.inject).toEqual(['commands'])
    expect('default' in commandBtw).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandBtw)).toBe(commandBtw)

    expect(test.ctx.commands.list(test.parent)).toContainEqual({
      name: 'btw',
      description: 'ask a side question against this session without disturbing it',
      input: { hint: '<question>' },
    })
    // recordInput stays absent (= true): command/run args are the parent
    // log's only record of the question, so the pairing must carry it.
    expect(test.ctx.commands.find(test.parent, 'btw')?.recordInput).toBeUndefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.parent, 'btw')).toBeUndefined()
  })

  it('rejects missing, blank, and unknown config at load', () => {
    expect(() => commandBtw.resolveConfig({} as never)).toThrow('Config needs a string `advisor`')
    expect(() => commandBtw.resolveConfig({ advisor: ' ' })).toThrow('non-empty `advisor`')
    expect(() => commandBtw.resolveConfig({ advisor: 'x', extra: true } as never)).toThrow('unknown key(s) extra')
    expect(commandBtw.resolveConfig({ advisor: 'x' })).toEqual({ advisor: 'x' })
  })
})

describe('/btw human command', () => {
  it('runs the side child on the route the parent last used, not its creation-time seed', async () => {
    // The web shape: options carry the create-time seed, while a mid-session
    // switch is recorded only as a later logged request header. The child must
    // follow the logged route.
    const primary = new MockAdapter([textResponse('parent turn one')])
    const secondary = new MockAdapter([textResponse('switched-route answer')])
    const test = await setupWithAdapters([
      { providers: ['mock'], adapter: primary },
      { providers: ['mock2'], adapter: secondary },
    ])
    await parentTurnOne(test)
    test.parent.session.append('request/header', {
      header: { config: { provider: 'mock2', model: 'switched' } },
      reason: 'change',
    })

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw switched?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'success', text: 'switched-route answer' })
    expect(secondary.requests).toHaveLength(1)
    expect(primary.requests).toHaveLength(1)
  })

  it('reports the failed turn when the parent declares no route anywhere', async () => {
    // Options empty and no logged header: the child inherits no route, its
    // turn fails inside the loop, and the command reports the failed turn
    // instead of throwing past the registry boundary.
    const test = await setup([textResponse('unused')])
    const routeless = test.ctx.agentLoop.create(SessionId('routeless'), {})

    const settled = await test.ctx.commands.execute(
      routeless,
      '/btw anywhere?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'error', text: 'The side question failed before answering.' })
    expect(routeless.session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
  })

  it('answers from a forked side child and leaves the parent untouched', async () => {
    const test = await setup([
      textResponse('parent turn one'),
      textResponse('side answer'),
      textResponse('parent turn two'),
    ])
    const prefixLength = await parentTurnOne(test)
    const parentMessagesBefore = test.parent.session.deriveMessages()
    const children = collectChildren(test.ctx, test.parent.session.header.id)

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw what changed?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'success', text: 'side answer' })

    // One side child, lineage-stamped, seeded with the completed-turn prefix.
    expect(children).toHaveLength(1)
    const child = children[0]!
    expect(String(child.session.header.parentSession)).toBe(String(test.parent.session.header.id))
    expect(child.session.header.origin).toBe('subagent')
    expect(child.session.header.seedLength).toBe(prefixLength)
    expect(child.session.events.slice(0, prefixLength)).toEqual(
      test.parent.session.events.slice(0, prefixLength),
    )

    // The advisor framing precedes the question in the child's own history.
    const ownMessages = child.session.events
      .filter(event => event.type === 'user/message' && event.seq >= prefixLength)
      .map(event => event.type === 'user/message' ? event.data : undefined)
    expect(ownMessages[0]?.source).toEqual({ kind: 'plugin', plugin: 'command-btw' })
    expect(ownMessages[0]?.content).toEqual([{ type: 'text', text: ADVISOR }])
    expect(ownMessages[1]?.source).toEqual({ kind: 'user' })
    expect(ownMessages[1]?.content).toEqual([{ type: 'text', text: 'what changed?' }])

    // The child's one request carries inherited context plus framing plus
    // question, in that order.
    const request = test.adapter.requests[1]
    expect(request).toBeDefined()
    const serialized = JSON.stringify(request?.messages)
    expect(serialized).toContain('parent q1')
    const advisorAt = serialized.indexOf(ADVISOR)
    const questionAt = serialized.indexOf('what changed?')
    expect(advisorAt).toBeGreaterThan(-1)
    expect(questionAt).toBeGreaterThan(advisorAt)

    // The parent gained only the generic command pairing; model history is
    // unchanged and the parent keeps working.
    expect(test.parent.session.events.slice(prefixLength).map(event => event.type))
      .toEqual(['command/run', 'command/done'])
    expect(test.parent.session.deriveMessages()).toEqual(parentMessagesBefore)
    test.parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent q2' }],
      source: { kind: 'user' },
    }))
    await test.parent.whenIdle()
    expect(lastAssistantText(test)).toBe('parent turn two')
  })

  it('answers from a fresh child before the parent completed any turn', async () => {
    const test = await setup([textResponse('fresh side answer')])
    const children = collectChildren(test.ctx, test.parent.session.header.id)

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw anything here?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'success', text: 'fresh side answer' })
    expect(children).toHaveLength(1)
    const child = children[0]!
    expect(child.session.header.seedLength).toBeUndefined()
    const firstOwn = child.session.events.find(event => event.type === 'user/message')
    expect(firstOwn?.type === 'user/message' && firstOwn.data.source).toEqual({
      kind: 'plugin',
      plugin: 'command-btw',
    })
  })

  it('rejects empty input without creating a child', async () => {
    const test = await setup([])
    const children = collectChildren(test.ctx, test.parent.session.header.id)
    const eventsBefore = test.parent.session.events.length

    const settled = await test.ctx.commands.execute(test.parent, '/btw', new AbortController().signal)
    expect(settled?.result).toEqual({
      kind: 'error',
      text: 'Side question text is required. Usage: /btw <question>',
    })
    expect(children).toHaveLength(0)
    expect(test.parent.session.events.slice(eventsBefore).map(event => event.type))
      .toEqual(['command/run', 'command/done'])
  })

  it('reports a failed side turn as a command error', async () => {
    const test = await setup([
      textResponse('parent turn one'),
      () => {
        throw new Error('boom')
      },
    ])
    await parentTurnOne(test)
    const children = collectChildren(test.ctx, test.parent.session.header.id)

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw broken?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'error', text: 'The side question failed before answering.' })
    const childEnd = children[0]!.session.events.findLast(event => event.type === 'turn/end')
    expect(childEnd?.type === 'turn/end' && childEnd.data.reason.kind).toBe('error')
  })

  it('reports a truncated side turn without an answer', async () => {
    const test = await setup([
      textResponse('parent turn one'),
      maxTokensResponse(''),
    ])
    await parentTurnOne(test)

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw truncated?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({
      kind: 'error',
      text: 'The side question hit the output-token ceiling before answering.',
    })
  })

  it('reports a side turn that completed without output', async () => {
    const test = await setup([
      textResponse('parent turn one'),
      textResponse(''),
    ])
    await parentTurnOne(test)

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw silent?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'error', text: 'The side question ended without an answer.' })
  })

  it('reports a refused side turn without a model call', async () => {
    const test = await setup([textResponse('parent turn one')])
    await parentTurnOne(test)
    const children = collectChildren(test.ctx, test.parent.session.header.id)
    test.ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (agent.session.header.parentSession !== undefined) return { kind: 'reject' }
      return next()
    })

    const settled = await test.ctx.commands.execute(
      test.parent,
      '/btw refused?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'error', text: 'The side question was refused before answering.' })
    expect(test.adapter.requests).toHaveLength(1)
    expect(children).toHaveLength(1)
  })

  it('treats a dispatch aborted inside the creation handoff as cancelled', async () => {
    const test = await setup([])
    const controller = new AbortController()
    // Wrap the registry so the signal aborts after `create()` resolves but
    // before the handler installs its live listener — the detach window the
    // post-registration check exists for.
    const realCreate = test.ctx.agents.create.bind(test.ctx.agents)
    const parentWithAbortAtHandoff = {
      options: test.parent.options,
      session: test.parent.session,
      ctx: {
        get: () => undefined,
        agents: {
          create: async (options: Parameters<typeof realCreate>[0]) => {
            const handle = await realCreate(options)
            controller.abort('handoff race')
            return handle
          },
        },
      },
    } as unknown as typeof test.parent
    const children = collectChildren(test.ctx, test.parent.session.header.id)

    // The registry races the handler against the signal; the already-aborted
    // signal wins the dispatch, while the handler itself converges the child.
    const execution = test.ctx.commands.execute(
      parentWithAbortAtHandoff,
      '/btw raced?',
      controller.signal,
    )
    await expect(execution).rejects.toThrow()
    await vi.waitFor(() => {
      expect(test.ctx.agents.get(children[0]!.id)).toBeUndefined()
    })
    expect(children).toHaveLength(1)
    expect(test.adapter.requests).toHaveLength(0)
  })

  it('cancels and disposes the side child when the dispatch aborts', async () => {
    const test = await setup([
      textResponse('parent turn one'),
      'hang',
    ])
    await parentTurnOne(test)
    const children = collectChildren(test.ctx, test.parent.session.header.id)
    const controller = new AbortController()

    const execution = test.ctx.commands.execute(test.parent, '/btw slow?', controller.signal)
    await vi.waitFor(() => {
      expect(test.adapter.requests).toHaveLength(2)
    })
    controller.abort()
    await expect(execution).rejects.toThrow()

    // The side child converged and left the registry; exactly one child was
    // created for the aborted question.
    await vi.waitFor(() => {
      expect(test.ctx.agents.get(children[0]!.id)).toBeUndefined()
    })
    expect(children).toHaveLength(1)
  })
})
