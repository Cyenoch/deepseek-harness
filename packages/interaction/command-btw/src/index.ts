/**
 * Human-facing `/btw <question>` side question: forks the receiving agent's
 * completed-turn prefix into a fresh child agent, frames it as a read-only
 * advisor, asks the side question in the child, and returns the child's final
 * answer as the command's direct UI text. The parent's model context is
 * untouched — the exchange lives in the child's own session, and the parent
 * log records only the generic `command/run`/`command/done` pairing.
 *
 * Agent Note:
 * - .agents/notes/implemented/feature/2026-08-15-btw-side-questions.md
 *
 * @module @deepseek-ai/dsh-command-btw
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  completedTurnPrefix,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'

export const name = 'command-btw'
export const inject = ['commands']

const USAGE = 'Usage: /btw <question>'

/** Config: the deployment-owned advisor framing injected into every side child. */
export interface Config {
  /**
   * Model-facing framing text injected as one plugin-sourced context message at
   * the head of every side child's own history. Must be non-empty.
   */
  advisor: string
}

export const Config: z<Config> = z.object({
  advisor: z.string(),
})

/**
 * Validate deployment-owned advisor framing. Missing, blank, or unknown fields
 * fail at plugin load rather than being ignored.
 * @param config Raw plugin config.
 * @returns A detached validated config.
 */
export function resolveConfig(config: Config): Config {
  const advisor = (config as Partial<Config>).advisor
  if (typeof advisor !== 'string') {
    throw new Error('Config needs a string `advisor`')
  }
  if (advisor.trim() === '') {
    throw new Error('Config needs a non-empty `advisor`')
  }
  const unknown = Object.keys(config).filter(key => key !== 'advisor')
  if (unknown.length > 0) {
    throw new Error(`Config has unknown key(s) ${unknown.join(', ')} — config is { advisor }`)
  }
  return { advisor }
}

/** One human sentence for why a side turn ended without usable output. */
function endSentence(reason: TurnEndReason | undefined): string {
  switch (reason?.kind) {
    case 'error':
      return 'The side question failed before answering.'
    case 'max-tokens':
      return 'The side question hit the output-token ceiling before answering.'
    case 'blocked':
      return 'The side question was refused before answering.'
    // TurnEndReason is merge-extensible, and an aborted or interrupted child
    // turn is read only through the race after cancellation settled separately
    // with its own sentence: every other end, including an empty completed
    // turn, keeps the generic sentence.
    default:
      return 'The side question ended without an answer.'
  }
}

/** Concatenate one answer's text blocks; empty string when there is no text. */
function answerText(blocks: readonly ContentBlock[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Read the side child's settled answer from its own events after the seed.
 * @param child The settled side child.
 * @param seedLength How many leading events came from the parent's log.
 * @returns The final answer text, or undefined when the turn produced none.
 */
function readAnswer(child: Agent, seedLength: number): { text: string } | { end: TurnEndReason | undefined } {
  const own = child.session.events.slice(seedLength)
  const text = answerText(finalAssistantOutput(own))
  if (text !== '') return { text }
  let end: TurnEndReason | undefined
  for (const event of own) {
    if (event.type === 'turn/end') end = event.data.reason
  }
  return { end }
}

/**
 * Resolve the route a side child should run on. The parent session's last
 * logged request header is the authoritative record of the route its requests
 * actually used — a mid-session model switch updates it while the creation-time
 * `AgentOptions` seed goes stale — so it wins whenever one exists; a parent
 * that has made no request yet falls back to its creation-time options.
 * @param parent - the agent whose effective route to read.
 * @returns the route fields to stamp on the child's agent options.
 */
function parentRoute(parent: Agent): AgentOptions {
  const logged = parent.session.requestHeader()?.config
  const source = logged ?? parent.options
  return {
    ...source.provider === undefined ? {} : { provider: source.provider },
    ...source.model === undefined ? {} : { model: source.model },
  }
}

/**
 * Establish, drive, and dispose one side child. The child is created through
 * the agent registry with the parent's completed-turn prefix as its seed, the
 * parent's composition and delegated policy, and one advisor context message;
 * the question is its single follow-up turn.
 * @param invocation The `/btw` command invocation carrying the parent agent.
 * @param advisor The validated advisor framing text.
 * @returns The settled command result.
 */
async function askSideQuestion(invocation: CommandInvocation, advisor: string): Promise<CommandResult> {
  const parent = invocation.agent
  const signal = invocation.signal
  const seed = completedTurnPrefix(parent)
  const childDepth = resolveChildDepth(parent, undefined)

  // Capture before the first await: a later parent switch belongs to the
  // parent's future.
  const inherited = captureDelegatedPolicyOverrides(parent)

  const setup = (childCtx: Context): void => {
    appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, inherited)
    // The side child joins the parent's composition unchanged: same preset,
    // same tool surface, plus the fixed delegation-scope statement. The
    // deployment persona and prompt sections stay byte-identical, so the
    // child's request prefix reuses the provider cache over inherited history.
    applyChildComposition(childCtx, parent, {})
  }

  const handle: AgentHandle = await parent.ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: childSessionMeta(parent, childDepth, seed.length),
    ...seed.length > 0 ? { seed } : {},
    agentOptions: resolveChildAgentOptions(parent, parentRoute(parent), childDepth),
    signal,
    setup,
  })

  // The abort handoff mirrors the in-process subagent driver's listener
  // registration race-for-race; extract shared child-run plumbing only if a
  // third driver appears.
  /* jscpd:ignore-start */
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning, so a
  // signal aborted inside that window is caught here, at the live listener's
  // registration boundary.
  if (signal.aborted) onAbort()
  /* jscpd:ignore-end */

  let outcome: CommandResult
  try {
    if (!flags.cancelled) {
      child.inject(createUserMessage({
        content: [{ type: 'text', text: advisor }],
        source: { kind: 'plugin', plugin: name },
      }))
      child.followup(createUserMessage({
        content: [{ type: 'text', text: invocation.rawInput.trim() }],
        source: { kind: 'user' },
      }))
    }
    await child.whenIdle()
    outcome = flags.cancelled
      ? { kind: 'error', text: 'Side question cancelled.' }
      : readSettlement(readAnswer(child, seed.length))
  } finally {
    signal.removeEventListener('abort', onAbort)
    await handle.dispose()
  }
  return outcome
}

/** Turn one answer read into the direct UI outcome. */
function readSettlement(read: { text: string } | { end: TurnEndReason | undefined }): CommandResult {
  return 'text' in read
    ? { kind: 'success', text: read.text }
    : { kind: 'error', text: endSentence(read.end) }
}

/**
 * Register the `/btw` side-question command for every composed command adapter.
 * The handler performs one whole child turn, so it can legitimately outlive
 * the dispatching UI request; an aborted dispatch cancels and disposes the
 * child while the registry settles the command as an error.
 */
export function apply(ctx: Context, config: Config): void {
  const { advisor } = resolveConfig(config)
  ctx.commands.register({
    name: 'btw',
    description: 'ask a side question against this session without disturbing it',
    input: { hint: '<question>' },
    handler: (invocation) => {
      if (invocation.rawInput.trim() === '') {
        return { kind: 'error', text: `Side question text is required. ${USAGE}` }
      }
      return askSideQuestion(invocation, advisor)
    },
  })
}
