// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

const ghosttyMocks = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue({}),
  terminals: [] as Array<{
    writes: Array<string | Uint8Array>
    element?: HTMLElement
    data?: (data: string) => void
    resize?: (dimensions: { cols: number; rows: number }) => void
    disposed: boolean
  }>,
}))

vi.mock('ghostty-web', () => {
  class MockTerminal {
    cols = 80
    rows = 24
    writes: Array<string | Uint8Array> = []
    data?: (data: string) => void
    resize?: (dimensions: { cols: number; rows: number }) => void
    disposed = false

    constructor() { ghosttyMocks.terminals.push(this) }
    loadAddon() {}
    open(element: HTMLElement) {
      const terminal = ghosttyMocks.terminals.at(-1)
      if (terminal) terminal.element = element
    }
    focus() {}
    write(data: string | Uint8Array) { this.writes.push(data) }
    dispose() { this.disposed = true }
    onData(listener: (data: string) => void) {
      this.data = listener
      return { dispose: () => { delete this.data } }
    }
    onResize(listener: (dimensions: { cols: number; rows: number }) => void) {
      this.resize = listener
      return { dispose: () => { delete this.resize } }
    }
  }

  class MockFitAddon {
    fit() {}
    proposeDimensions() { return { cols: 96, rows: 28 } }
    observeResize() {}
    dispose() {}
  }

  return {
    Ghostty: { load: ghosttyMocks.load },
    Terminal: MockTerminal,
    FitAddon: MockFitAddon,
  }
})

import { TerminalApp, TerminalLaunchCard } from '../src/client/TerminalApp.tsx'
import { SidePanelToggle } from '../src/client/SidePanelToggle.tsx'
import type {
  SidePanelLaunchCardProps, SidePanelToggleProps, TerminalAppProps,
} from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'

const t = ((key: keyof typeof en) => en[key]) as TerminalAppProps['t']

function terminalProps(overrides: Partial<TerminalAppProps> = {}): TerminalAppProps {
  return {
    sessionId: 's-1' as never,
    listBackends: vi.fn().mockResolvedValue(['shell']),
    attach: vi.fn().mockResolvedValue({
      sessionId: 'pty-1',
      backendType: 'shell',
      resumed: false,
      resizeSupported: true,
    }),
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue({ data: '\u001b[32mready\u001b[0m', cursor: 14, truncated: false, status: 'exited' }),
    resize: vi.fn().mockResolvedValue({ supported: true }),
    closeTerminal: vi.fn().mockResolvedValue(true),
    t,
    ...overrides,
  } as unknown as TerminalAppProps
}

beforeEach(() => {
  ghosttyMocks.terminals.length = 0
  ghosttyMocks.load.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 640 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 480 })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TerminalApp', () => {
  it('shows a no-session notice without loading the WASM runtime', () => {
    const props = terminalProps({ sessionId: undefined })
    const { getByText } = render(<TerminalApp {...props} />)
    expect(getByText(en['terminal.noSession'])).toBeTruthy()
    expect(props.listBackends).not.toHaveBeenCalled()
    expect(ghosttyMocks.load).not.toHaveBeenCalled()
  })

  it('renders retained VT output, sends input, and closes the PTY on unmount', async () => {
    const props = terminalProps()
    const view = render(<TerminalApp {...props} />)

    await waitFor(() => { expect(props.attach).toHaveBeenCalled() })
    expect(ghosttyMocks.load).toHaveBeenCalledOnce()
    expect(props.attach).toHaveBeenCalledWith('s-1', {
      backendType: 'shell',
      name: 'sidepanel-terminal',
      cols: 96,
      rows: 28,
    }, expect.any(AbortSignal))
    await waitFor(() => { expect(ghosttyMocks.terminals[0]?.writes).toEqual(['\u001b[32mready\u001b[0m']) })
    ghosttyMocks.terminals[0]?.data?.('pwd\r')
    await waitFor(() => { expect(props.write).toHaveBeenCalledWith('s-1', 'pty-1', 'pwd\r') })
    expect(view.getByText(en['terminal.status.exited'])).toBeTruthy()

    view.unmount()
    await waitFor(() => { expect(props.closeTerminal).toHaveBeenCalledWith('s-1', 'pty-1') })
    expect(ghosttyMocks.terminals[0]?.disposed).toBe(true)
  })

  it('answers a primary device attributes query missing from the pinned renderer', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ data: '\u001b[0', cursor: 3, truncated: false, status: 'running' })
      .mockResolvedValueOnce({ data: 'c', cursor: 4, truncated: false, status: 'exited' })
    const props = terminalProps({
      read,
    })
    render(<TerminalApp {...props} />)

    await waitFor(() => {
      expect(props.write).toHaveBeenCalledWith('s-1', 'pty-1', '\u001b[?1;2c')
    })
  })

  it('renders a decoration-free canvas and suppresses the host DOM caret', async () => {
    const read = vi.fn<TerminalAppProps['read']>((_sessionId, _id, _cursor, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const reason: unknown = signal.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }, { once: true })
      }))
    const props = terminalProps({
      read,
    })
    const view = render(<TerminalApp {...props} />)

    await waitFor(() => { expect(props.attach).toHaveBeenCalled() })
    expect(view.queryByText('Connected')).toBeNull()
    expect(view.queryByText('shell')).toBeNull()
    expect(ghosttyMocks.terminals.at(-1)?.element?.style.caretColor).toBe('transparent')
  })

  it('aborts a pending read before closing the PTY on unmount', async () => {
    let readSignal: AbortSignal | undefined
    const read = vi.fn<TerminalAppProps['read']>((_sessionId, _id, _cursor, signal) => {
      readSignal = signal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const reason: unknown = signal.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        }, { once: true })
      })
    })
    const props = terminalProps({ read })
    const view = render(<TerminalApp {...props} />)

    await waitFor(() => { expect(read).toHaveBeenCalled() })
    expect(readSignal?.aborted).toBe(false)
    view.unmount()
    expect(readSignal?.aborted).toBe(true)
    await waitFor(() => { expect(props.closeTerminal).toHaveBeenCalledWith('s-1', 'pty-1') })
  })

  it('asks the user to choose when several interactive backends are available', async () => {
    const props = terminalProps({ listBackends: vi.fn().mockResolvedValue(['local', 'remote']) })
    const view = render(<TerminalApp {...props} />)
    await waitFor(() => { expect(view.getByText(en['terminal.chooseBackend'])).toBeTruthy() })
    expect(props.attach).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'remote' }))
    await waitFor(() => {
      expect(props.attach).toHaveBeenCalledWith('s-1', expect.objectContaining({ backendType: 'remote' }), expect.any(AbortSignal))
    })
  })

  it('launch card opens the terminal tab with its localized title', () => {
    const open = vi.fn()
    const props = { open, t } as unknown as SidePanelLaunchCardProps
    const { getByRole } = render(<TerminalLaunchCard {...props} />)
    fireEvent.click(getByRole('button'))
    expect(open).toHaveBeenCalledWith({ id: 'terminal', title: 'Terminal' })
  })
})

describe('SidePanelToggle', () => {
  it('delegates a click to the injected toggle action', () => {
    const toggle = vi.fn()
    const props = { toggle, t } as unknown as SidePanelToggleProps
    const { getByRole } = render(<SidePanelToggle {...props} />)
    fireEvent.click(getByRole('button'))
    expect(toggle).toHaveBeenCalledOnce()
  })
})
