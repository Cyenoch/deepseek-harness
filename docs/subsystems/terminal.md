# Persistent PTY Sessions

English | [中文](terminal.zh.md)

Types shared by PTY backends, `ctx.terminals`, the model-facing consumer, and the browser terminal Remote API. The [persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) owns the original rationale; the [side-panel Agent Note](../../.agents/notes/implemented/feature/2026-08-15-side-panel-tabbed-right-column.md) owns the human attachment. This page records the cross-package vocabulary from [`types.ts`](../../packages/terminal/terminal/src/types.ts) and [`remote-types.ts`](../../packages/terminal/terminal/src/remote-types.ts).

## Identity and readiness

`TerminalSessionId` is a service-minted branded id. Optional names are owner-local display metadata; authorization compares the exact owning `Agent`, not a name or guessed id.

`TerminalWaitReason` says why one send returned. It is independent from `TerminalSessionStatus`: silence or timeout may return while the top-level shell remains alive, while `session_exit` means that shell exited rather than an arbitrary foreground child.

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## Backend and live session

A backend owns how one registered type starts and detects readiness. `TerminalSessionService` publishes the returned session only after setup succeeds, then owns id authorization and cleanup. A backend that cannot clean partial startup resources rejects with `TerminalBackendCleanupError`, allowing disposal to retain the cleanup failure without replacing the caller's cancellation reason. A backend session owns terminal state and captured-resource quiescence.

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Whether spawned sessions provide {@link TerminalBackendSession.interactive}. */
  readonly supportsInteractive?: boolean
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Raw human-terminal transport when this backend supports attachment. */
  readonly interactive?: TerminalInteractiveSession
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## Human attachment

An interactive backend adds a raw byte-stream view without changing the model-facing send/read behavior. The browser Remote API uses a client-safe branded identity and explicit attach, stream, and resize payloads; the Host resolves the calling Agent and retains authorization and cleanup ownership.

```ts type-equiv
/** Optional raw terminal transport implemented by backends that support human attachment. */
interface TerminalInteractiveSession {
  /** Write raw input without implicit newline or send-readiness tracking. */
  write(data: string): Promise<void>
  /** Wait for and read raw VT output after one stream cursor. */
  read(cursor: number, signal: AbortSignal): Promise<TerminalBackendStreamRead>
  /** Synchronize PTY rows and columns; false means the provider cannot resize. */
  resize(cols: number, rows: number): Promise<boolean>
}
```

```ts type-equiv
/** Opaque owner-scoped identity for one live PTY session. */
type TerminalSessionIdValue = Branded<'TerminalSessionId'>
```

```ts type-equiv
/** Request to attach a human-facing terminal renderer to an owner-scoped PTY. */
interface TerminalAttachRequest {
  /** Registered backend selected from the terminal service's interactive backend list. */
  backendType: string
  /** Stable owner-local name used to resume the same PTY after a UI remount. */
  name: string
  /** Optional initial working directory interpreted by the backend. */
  cwd?: string
  /** Initial terminal columns measured by the renderer. */
  cols: number
  /** Initial terminal rows measured by the renderer. */
  rows: number
}
```

```ts type-equiv
/** Published or resumed PTY returned to a human-facing terminal renderer. */
interface TerminalAttachResult {
  /** Owner-scoped PTY identity used by later stream operations. */
  sessionId: TerminalSessionIdValue
  /** Backend type that owns the PTY. */
  backendType: string
  /** Whether an existing named PTY was reused. */
  resumed: boolean
  /** Whether the provider accepted the requested terminal dimensions. */
  resizeSupported: boolean
}
```

```ts type-equiv
/** Incremental raw terminal output for a VT renderer. */
interface TerminalStreamReadResult {
  /** Raw UTF-8-decoded VT data after the supplied cursor. */
  data: string
  /** Cursor for the next read, measured in the stream's string code units. */
  cursor: number
  /** Whether retained output preceding this result was dropped. */
  truncated: boolean
  /** Current top-level PTY state. */
  status: 'running' | 'exited'
}
```

```ts type-equiv
/** Result of synchronizing the remote PTY dimensions. */
interface TerminalResizeResult {
  /** False when the subprocess provider cannot resize its PTY. */
  supported: boolean
}
```

## Send and retained output

One live session accepts one active send. Its operation exposes a consuming output cursor for generic background jobs and one terminal result for a foreground caller. `TerminalReadResult` separately pages the bounded session scrollback.

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## Ownership and durability

`TerminalSessionService` attaches one awaited cleanup to the exact owner scope, rejects foreign operations, and keeps sessions alive across backend or tool-plugin reload. PTY state and raw bytes remain process-local. Model input and bounded returned output are durable through the existing `tool/call`, `tool/result`, and task-result paths rather than duplicate PTY session events.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

In-process registry for replaceable PTY backends and exact-Agent sessions.

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * List backend types that can serve a human terminal renderer.
 * @param agent - resolved live Agent whose identity authorizes this Remote call.
 * @returns interactive backend types in registration order.
 */
@Remote interactiveBackends(agent: Agent): string[]

/**
 * Resume an owner-local named PTY or create it through the selected backend.
 * @param agent - exact session owner.
 * @param request - backend, stable name, working directory, and initial dimensions.
 * @param signal - cancellation of a new unpublished PTY allocation.
 * @returns attached PTY identity and resize support.
 */
@Remote async attach(agent: Agent, request: TerminalAttachRequest, signal: AbortSignal): Promise<TerminalAttachResult>

/**
 * Write raw user input to an attached PTY.
 * @param agent - exact session owner.
 * @param id - attached PTY identity.
 * @param data - raw terminal input without newline conversion.
 */
@Remote async writeInput(agent: Agent, id: TerminalSessionIdValue, data: string): Promise<void>

/**
 * Wait for raw VT output after a cursor.
 * @param agent - exact session owner.
 * @param id - attached PTY identity.
 * @param cursor - previous result cursor, starting at zero.
 * @param signal - cancellation while no output is available.
 * @returns output delta, next cursor, retention flag, and process state.
 */
@Remote async readStream( agent: Agent, id: TerminalSessionIdValue, cursor: number, signal: AbortSignal, ): Promise<TerminalStreamReadResult>

/**
 * Synchronize one attached PTY with renderer dimensions.
 * @param agent - exact session owner.
 * @param id - attached PTY identity.
 * @param cols - positive terminal column count.
 * @param rows - positive terminal row count.
 * @returns whether the provider supports resizing.
 */
@Remote async resize(agent: Agent, id: TerminalSessionIdValue, cols: number, rows: number): Promise<TerminalResizeResult>

/**
 * Close one attached PTY.
 * @param agent - exact session owner.
 * @param id - attached PTY identity.
 * @returns whether this call began the close.
 */
@Remote('close') closeAttached(agent: Agent, id: TerminalSessionIdValue): Promise<boolean>

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

Types: [Agent](core.md)

Source: [`packages/terminal/terminal/src/index.ts:123`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
