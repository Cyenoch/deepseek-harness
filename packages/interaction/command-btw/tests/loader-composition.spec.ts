import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as CommandBtw from '@deepseek-ai/dsh-command-btw'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('/btw real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and answers one side question without touching the parent log', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-btw-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-agent-loop'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-command-btw'",
      '  config:',
      '    advisor: You are a read-only side advisor.',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-agent-loop', AgentLoop],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-command-btw', CommandBtw],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const adapter = new MockAdapter([textResponse('side answer from loader boot')])
    context.llm.registerAdapter(['mock'], adapter)
    const agent = context.agentLoop.create(SessionId('btw-loader-agent'), { provider: 'mock', model: 'mock' })

    // Discoverable through the composed registry, as a UI adapter finds it.
    expect(context.commands.list(agent).map(command => command.name)).toContain('btw')

    const settled = await context.commands.execute(
      agent,
      '/btw what changed?',
      new AbortController().signal,
    )
    expect(settled?.result).toEqual({ kind: 'success', text: 'side answer from loader boot' })

    // The parent log holds only the generic command pairing; nothing reached
    // its model history or surface.
    expect(agent.session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(agent.session.deriveMessages()).toEqual([])
    expect(agent.session.surface.nodes).toEqual([])

    // The side child asked exactly one request, forked from this session.
    expect(adapter.requests).toHaveLength(1)
    const child = adapter.requests[0]?.messages
    expect(JSON.stringify(child)).toContain('what changed?')
  })
})
