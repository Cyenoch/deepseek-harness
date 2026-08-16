// @vitest-environment jsdom
/**
 * BtwApp behavior: the /btw transcript derives from the conversation nodes
 * snapshot (question from command args, answer from the settled outcome,
 * pending while the pairing is open), the ask input submits through the
 * injected face, and the no-session state has its own copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { CommandNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { BtwApp, BtwLaunchCard } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/BtwApp.tsx'
import type { BtwAppProps } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/contract/slots.ts'
import { en } from '@deepseek-ai/dsh-client-ui-sidepanel/src/client/locales.ts'

const t = ((key: keyof typeof en) => en[key]) as BtwAppProps['t']

function commandNode(over: Partial<CommandNode>): CommandNode {
  return {
    kind: 'command',
    seq: 1,
    time: 1,
    commandId: 'cmd-1' as CommandNode['commandId'],
    name: 'btw',
    args: 'what changed?',
    outcome: null,
    ...over,
  }
}

/** Snapshot-backed maybe-hook stub; `undefined` models the no-session arm. */
function useSessionOf(nodes: CommandNode[] | undefined): BtwAppProps['useSession'] {
  return ((sel: (s: ConversationSnapshot) => unknown) =>
    nodes === undefined ? undefined : sel({ nodes } as unknown as ConversationSnapshot)) as BtwAppProps['useSession']
}

function mountBtw(
  nodes: CommandNode[] | undefined,
  sessionId: string | undefined,
  ask = vi.fn().mockResolvedValue(undefined),
) {
  const props = { useSession: useSessionOf(nodes), sessionId, ask, t } as unknown as BtwAppProps
  return { ask, ...render(<BtwApp {...props} />) }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup() })

describe('BtwApp', () => {
  it('shows the no-session copy while no session is current', () => {
    const { getByText } = mountBtw(undefined, undefined)
    expect(getByText('Select a session to ask about it.')).toBeTruthy()
  })

  it('renders the empty copy with no exchanges', () => {
    const { getByText } = mountBtw([], 's-1')
    expect(getByText('No side questions yet. Type one to start.')).toBeTruthy()
  })

  it('renders one exchange per /btw command: pending, success, error', () => {
    const nodes = [
      commandNode({ commandId: 'cmd-a' as CommandNode['commandId'], args: 'q1', outcome: null }),
      commandNode({
        commandId: 'cmd-b' as CommandNode['commandId'],
        args: 'q2',
        outcome: { kind: 'success', text: 'answer two' },
      }),
      commandNode({
        commandId: 'cmd-c' as CommandNode['commandId'],
        args: 'q3',
        outcome: { kind: 'error', text: 'boom' },
      }),
    ]
    const { getByText } = mountBtw(nodes, 's-1')
    expect(getByText('q1')).toBeTruthy()
    expect(getByText('Thinking…')).toBeTruthy()
    expect(getByText('answer two')).toBeTruthy()
    expect(getByText('boom')).toBeTruthy()
  })

  it('renders fallbacks for absent command args and absent outcome text', () => {
    const nodes = [
      commandNode({ commandId: 'cmd-a' as CommandNode['commandId'], args: null, outcome: { kind: 'success' } }),
      commandNode({ commandId: 'cmd-b' as CommandNode['commandId'], args: 'q', outcome: { kind: 'error' } }),
    ]
    const { getByText, getAllByText } = mountBtw(nodes, 's-1')
    expect(getByText('q')).toBeTruthy()
    // Text-less outcomes of either kind fall back to the failure label.
    expect(getAllByText('The question failed to submit')).toHaveLength(2)
  })

  it('an empty draft does not submit; a non-Enter key never submits', async () => {
    const { getByPlaceholderText, ask } = mountBtw([], 's-1')
    fireEvent.keyDown(getByPlaceholderText('Ask a side question…'), { key: 'Enter' })
    expect(ask).not.toHaveBeenCalled()
    fireEvent.change(getByPlaceholderText('Ask a side question…'), { target: { value: 'draft' } })
    fireEvent.keyDown(getByPlaceholderText('Ask a side question…'), { key: 'a' })
    expect(ask).not.toHaveBeenCalled()
  })

  it('ignores non-btw command rows in the derivation', () => {
    const nodes = [commandNode({ commandId: 'cmd-a' as CommandNode['commandId'], name: 'feedback', args: 'not btw' })]
    const { getByText } = mountBtw(nodes, 's-1')
    expect(getByText('No side questions yet. Type one to start.')).toBeTruthy()
  })

  it('submits the draft through ask and clears it on success', async () => {
    const { getByPlaceholderText, getByText, ask } = mountBtw([], 's-1')
    const input = getByPlaceholderText('Ask a side question…')
    fireEvent.change(input, { target: { value: 'why did it fail?' } })
    fireEvent.click(getByText('Ask'))
    await waitFor(() => { expect(ask).toHaveBeenCalledWith('s-1', 'why did it fail?') })
    await waitFor(() => { expect(input.getAttribute('value')).toBe('') })
  })

  it('surfaces the failure copy when ask rejects', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('transport'))
    const utils = render(<BtwApp {...{ useSession: useSessionOf([]), sessionId: 's-1', ask: failing, t } as unknown as BtwAppProps} />)
    fireEvent.change(utils.getByPlaceholderText('Ask a side question…'), { target: { value: 'q' } })
    fireEvent.click(utils.getByText('Ask'))
    await waitFor(() => { expect(utils.getByText('The question failed to submit')).toBeTruthy() })
  })
})

describe('BtwLaunchCard', () => {
  it('opens the btw tab with its localized title', () => {
    const open = vi.fn()
    render(<BtwLaunchCard {...{ open, t } as unknown as import('@deepseek-ai/dsh-client-ui-sidepanel/src/client/contract/slots.ts').SidePanelLaunchCardProps} />)
    fireEvent.click(document.querySelector('button')!)
    expect(open).toHaveBeenCalledWith({ id: 'btw', title: 'Side chat' })
  })
})
