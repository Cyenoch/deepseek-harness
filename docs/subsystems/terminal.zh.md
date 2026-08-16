# 持久 PTY 会话

[English](terminal.md) | 中文

本页记录 PTY 后端、`ctx.terminals`、面向模型的消费方与浏览器终端 Remote API 共享的类型。[持久 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) 负责记录原始决策依据；[侧栏 Agent Note](../../.agents/notes/implemented/feature/2026-08-15-side-panel-tabbed-right-column.md) 负责记录人工附加能力。跨包词汇来自 [`types.ts`](../../packages/terminal/terminal/src/types.ts) 与 [`remote-types.ts`](../../packages/terminal/terminal/src/remote-types.ts)。

## 标识与就绪

`TerminalSessionId` 是由服务铸造的branded id。可选名称是拥有者本地的显示元数据；授权比较的是拥有该会话的确切 `Agent`，而不是名称或猜测的 id。

`TerminalWaitReason` 说明一次发送为何返回。它与 `TerminalSessionStatus` 无关：一次发送可能因静默或超时而返回，但顶层 shell 仍然存活；`session_exit` 表示该 shell 已退出，而不是某个任意的前台子进程已退出。

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

## 后端与活跃会话

后端负责启动某种已注册类型的会话并检测其就绪状态。`TerminalSessionService` 只在初始化成功后才发布返回的会话，随后负责 id 授权与清理。无法清理部分启动资源时，后端会以 `TerminalBackendCleanupError` 拒绝启动；这样，资源释放流程既能保留清理失败，也不会用它替换调用方的取消原因。后端会话拥有终端状态，并负责让已捕获的资源完全停稳。

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

## 人工附加

交互式后端会在不改变面向模型的发送／读取行为的前提下，增加原始字节流视图。浏览器 Remote API 使用可供 Client 安全引用的 branded id，以及显式的附加、流读取与尺寸调整 payload；Host 负责解析发起调用的 Agent，并继续拥有授权与清理职责。

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

## 发送与保留输出

一个活跃会话同时只接受一个活动发送。该操作向通用后台任务提供读取后即推进的输出游标，并向前台调用方提供最终结果。`TerminalReadResult` 则为有界的会话 scrollback 单独分页。

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

## 归属与持久性

`TerminalSessionService` 会将一项等待完成的清理附加到确切的拥有者作用域，拒绝其他拥有者的操作，并让会话在后端或工具插件重载期间保持存活。PTY 状态与原始字节仍局限在进程内。模型输入与有界返回输出通过现有 `tool/call`、`tool/result` 和任务结果路径持久保存，而不是重复记录 PTY 会话事件。

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
