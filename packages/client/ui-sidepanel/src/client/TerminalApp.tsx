/** Human terminal rendered by ghostty-web's libghostty-vt WASM core. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FitAddon, Ghostty, Terminal } from 'ghostty-web'
import type { SidePanelLaunchCardProps, TerminalAppProps } from './contract/slots.ts'
import { LaunchCard } from './LaunchCard.tsx'
import css from './SidePanelRoot.module.css'

const TERMINAL_NAME = 'sidepanel-terminal'
const PRIMARY_DEVICE_ATTRIBUTES_RESPONSE = '\u001b[?1;2c'
const PRIMARY_DEVICE_ATTRIBUTES_QUERIES = ['\u001b[c', '\u001b[0c'] as const
const PRIMARY_DEVICE_ATTRIBUTES_QUERY_MAX_LENGTH = Math.max(
  ...PRIMARY_DEVICE_ATTRIBUTES_QUERIES.map(query => query.length),
)
let ghostty: Promise<Ghostty> | undefined

function loadGhostty(): Promise<Ghostty> {
  ghostty ??= Ghostty.load().catch((error: unknown) => {
    ghostty = undefined
    throw error
  })
  return ghostty
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new DOMException('Terminal view disposed', 'AbortError')
}

function visible(element: HTMLElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0
}

function scanPrimaryDeviceAttributesQuery(
  carry: string,
  data: string,
): { readonly carry: string; readonly found: boolean } {
  const text = carry + data
  let nextCarry = ''
  for (let length = 1; length < PRIMARY_DEVICE_ATTRIBUTES_QUERY_MAX_LENGTH; length += 1) {
    const suffix = text.slice(-length)
    if (PRIMARY_DEVICE_ATTRIBUTES_QUERIES.some(query => length < query.length && query.startsWith(suffix))) {
      nextCarry = suffix
    }
  }
  return {
    carry: nextCarry,
    found: PRIMARY_DEVICE_ATTRIBUTES_QUERIES.some(query => text.includes(query)),
  }
}

function isPrimaryDeviceAttributesResponse(data: string): boolean {
  return /\u001b\[\?[0-9;]*c/.test(data)
}

async function waitUntilVisible(element: HTMLElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (visible(element)) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      observer.disconnect()
      signal.removeEventListener('abort', onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    const observer = new ResizeObserver(() => {
      if (visible(element)) finish()
    })
    const onAbort = (): void => { finish(abortReason(signal)) }
    observer.observe(element)
    signal.addEventListener('abort', onAbort, { once: true })
    if (visible(element)) finish()
  })
}

type TerminalPhase = 'idle' | 'connecting' | 'connected' | 'exited' | 'error'

/** Terminal tab body: backend selection, connection lifecycle, and VT canvas. */
export function TerminalApp({
  sessionId,
  listBackends,
  attach,
  write,
  read,
  resize,
  closeTerminal,
  t,
}: TerminalAppProps) {
  const container = useRef<HTMLDivElement>(null)
  const [backends, setBackends] = useState<readonly string[] | undefined>()
  const [selectedBackend, setSelectedBackend] = useState<string | undefined>()
  const [phase, setPhase] = useState<TerminalPhase>('idle')
  const [failure, setFailure] = useState<string | undefined>()
  const [truncated, setTruncated] = useState(false)
  const [revision, setRevision] = useState(0)
  const backend = selectedBackend ?? (backends?.length === 1 ? backends[0] : undefined)

  useEffect(() => {
    let current = true
    setSelectedBackend(undefined)
    setFailure(undefined)
    setTruncated(false)
    if (sessionId === undefined) {
      setBackends(undefined)
      setPhase('idle')
      return () => { current = false }
    }
    setBackends(undefined)
    setPhase('connecting')
    void listBackends(sessionId).then(
      (available) => {
        if (!current) return
        setBackends(available)
        if (available.length !== 1) setPhase('idle')
      },
      (error: unknown) => {
        if (!current) return
        setFailure(messageOf(error))
        setPhase('error')
      },
    )
    return () => { current = false }
  }, [listBackends, sessionId])

  useEffect(() => {
    const element = container.current
    if (sessionId === undefined || backend === undefined || element === null) return
    const controller = new AbortController()
    let terminal: Terminal | undefined
    let fit: FitAddon | undefined
    let attached: Awaited<ReturnType<TerminalAppProps['attach']>> | undefined
    let inputSubscription: { dispose(): void } | undefined
    let resizeSubscription: { dispose(): void } | undefined
    let deviceAttributesCarry = ''
    const outputState = { processing: false, rendererAnsweredDeviceAttributes: false }
    setFailure(undefined)
    setTruncated(false)
    setPhase('connecting')

    const connect = async (): Promise<void> => {
      await waitUntilVisible(element, controller.signal)
      const engine = await loadGhostty()
      controller.signal.throwIfAborted()
      terminal = new Terminal({
        ghostty: engine,
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        scrollback: 10_000,
        theme: {
          background: '#0d1117',
          foreground: '#d6dae1',
          cursor: '#8fb8ff',
          selectionBackground: '#28466f',
          black: '#1b1f27',
          red: '#ff7b72',
          green: '#7ee787',
          yellow: '#d29922',
          blue: '#79c0ff',
          magenta: '#d2a8ff',
          cyan: '#56d4dd',
          white: '#d6dae1',
          brightBlack: '#6e7681',
        },
      })
      fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(element)
      // ghostty-web makes its host contenteditable for input. The browser's
      // native caret must stay hidden; libghostty paints the terminal cursor.
      element.style.caretColor = 'transparent'
      fit.fit()
      const dimensions = fit.proposeDimensions() ?? { cols: terminal.cols, rows: terminal.rows }
      attached = await attach(sessionId, {
        backendType: backend,
        name: TERMINAL_NAME,
        cols: dimensions.cols,
        rows: dimensions.rows,
      }, controller.signal)
      controller.signal.throwIfAborted()
      const sendInput = (data: string): void => {
        if (attached === undefined) return
        void write(sessionId, attached.sessionId, data).catch((error: unknown) => {
          if (controller.signal.aborted) return
          setFailure(messageOf(error))
          setPhase('error')
        })
      }
      inputSubscription = terminal.onData((data) => {
        if (outputState.processing && isPrimaryDeviceAttributesResponse(data)) {
          outputState.rendererAnsweredDeviceAttributes = true
        }
        sendInput(data)
      })
      resizeSubscription = terminal.onResize(({ cols, rows }) => {
        if (attached === undefined) return
        void resize(sessionId, attached.sessionId, cols, rows).catch((error: unknown) => {
          if (controller.signal.aborted) return
          setFailure(messageOf(error))
          setPhase('error')
        })
      })
      fit.observeResize()
      terminal.focus()
      setPhase('connected')

      let cursor = 0
      while (!controller.signal.aborted) {
        const next = await read(sessionId, attached.sessionId, cursor, controller.signal)
        if (next.data.length > 0) {
          const query = scanPrimaryDeviceAttributesQuery(deviceAttributesCarry, next.data)
          deviceAttributesCarry = query.carry
          outputState.rendererAnsweredDeviceAttributes = false
          outputState.processing = true
          try {
            terminal.write(next.data)
          } finally {
            outputState.processing = false
          }
          // terminal.write synchronously triggers onData; TypeScript cannot see that callback's state mutation.
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- Read the synchronous callback result.
          if (query.found && !outputState.rendererAnsweredDeviceAttributes) {
            sendInput(PRIMARY_DEVICE_ATTRIBUTES_RESPONSE)
          }
        }
        if (next.truncated) setTruncated(true)
        cursor = next.cursor
        if (next.status === 'exited') {
          setPhase('exited')
          return
        }
      }
    }

    void connect().catch((error: unknown) => {
      if (controller.signal.aborted) return
      setFailure(messageOf(error))
      setPhase('error')
    })

    return () => {
      controller.abort(new DOMException('Terminal view disposed', 'AbortError'))
      inputSubscription?.dispose()
      resizeSubscription?.dispose()
      fit?.dispose()
      terminal?.dispose()
      if (attached !== undefined) {
        void closeTerminal(sessionId, attached.sessionId).catch((_viewAlreadyClosing: unknown) => {
          // Agent/service teardown owns any PTY that disappeared before this best-effort view cleanup.
        })
      }
    }
  }, [attach, backend, closeTerminal, read, resize, revision, sessionId, write])

  const noBackend = backends?.length === 0
  const needsChoice = (backends?.length ?? 0) > 1 && backend === undefined
  let notice: ReactNode = null
  if (sessionId === undefined) {
    notice = <div className={css.terminalNotice}>{t('terminal.noSession')}</div>
  } else if (noBackend) {
    notice = <div className={css.terminalNotice}>{t('terminal.unavailable')}</div>
  } else if (needsChoice) {
    notice = (
      <div className={css.terminalNotice}>
        <span>{t('terminal.chooseBackend')}</span>
        <div className={css.terminalBackendList}>
          {backends?.map(candidate => (
            <button key={candidate} type="button" onClick={() => { setSelectedBackend(candidate) }}>
              {candidate}
            </button>
          ))}
        </div>
      </div>
    )
  } else if (failure !== undefined) {
    notice = (
      <div className={css.terminalNotice} data-error>
        <span>{failure}</span>
        {backend !== undefined ? (
          <button type="button" className={css.terminalAction} onClick={() => { setRevision(value => value + 1) }}>
            {t('terminal.retry')}
          </button>
        ) : null}
      </div>
    )
  } else if (phase === 'connecting') {
    notice = <div className={css.terminalNotice}>{t('terminal.connecting')}</div>
  } else if (phase === 'exited') {
    notice = (
      <div className={css.terminalNotice}>
        <span>{t('terminal.status.exited')}</span>
        <button type="button" className={css.terminalAction} onClick={() => { setRevision(value => value + 1) }}>
          {t('terminal.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={css.terminalRoot} role="region" aria-label={t('terminal.canvas')}>
      <div ref={container} className={css.terminalCanvas} style={{ caretColor: 'transparent' }} />
      {notice}
      {truncated ? <div className={css.terminalWarning}>{t('terminal.truncated')}</div> : null}
    </div>
  )
}

/** Terminal launchpad card. */
export function TerminalLaunchCard({ open, t }: SidePanelLaunchCardProps) {
  return (
    <LaunchCard
      icon={<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M3 4.5l3 3-3 3M8 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>}
      title={t('terminal.title')}
      description={t('terminal.description')}
      onOpen={() => { open({ id: 'terminal', title: t('terminal.title') }) }}
    />
  )
}
