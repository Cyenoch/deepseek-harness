/**
 * Browser-safe PTY vocabulary carried by the generated Remote namespace.
 * @module @deepseek-ai/dsh-terminal/remote-types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque owner-scoped identity for one live PTY session. */
export type TerminalSessionIdValue = Branded<'TerminalSessionId'>

/** Request to attach a human-facing terminal renderer to an owner-scoped PTY. */
export interface TerminalAttachRequest {
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

/** Published or resumed PTY returned to a human-facing terminal renderer. */
export interface TerminalAttachResult {
  /** Owner-scoped PTY identity used by later stream operations. */
  sessionId: TerminalSessionIdValue
  /** Backend type that owns the PTY. */
  backendType: string
  /** Whether an existing named PTY was reused. */
  resumed: boolean
  /** Whether the provider accepted the requested terminal dimensions. */
  resizeSupported: boolean
}

/** Incremental raw terminal output for a VT renderer. */
export interface TerminalStreamReadResult {
  /** Raw UTF-8-decoded VT data after the supplied cursor. */
  data: string
  /** Cursor for the next read, measured in the stream's string code units. */
  cursor: number
  /** Whether retained output preceding this result was dropped. */
  truncated: boolean
  /** Current top-level PTY state. */
  status: 'running' | 'exited'
}

/** Result of synchronizing the remote PTY dimensions. */
export interface TerminalResizeResult {
  /** False when the subprocess provider cannot resize its PTY. */
  supported: boolean
}
