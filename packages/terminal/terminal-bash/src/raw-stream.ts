/** Bounded, cursor-addressed raw VT output retained for human terminal clients. */
import { Buffer } from 'node:buffer'
import type { TerminalBackendStreamRead } from '@deepseek-ai/dsh-terminal'

function utf8Head(text: string, maxBytes: number): string {
  let bytes = 0
  let result = ''
  for (const character of text) {
    const next = Buffer.byteLength(character, 'utf8')
    if (bytes + next > maxBytes) break
    result += character
    bytes += next
  }
  return result
}

function utf8Tail(text: string, maxBytes: number): string {
  const characters = Array.from(text)
  let bytes = 0
  let start = characters.length
  while (start > 0) {
    const next = Buffer.byteLength(characters[start - 1] as string, 'utf8')
    if (bytes + next > maxBytes) break
    bytes += next
    start -= 1
  }
  return characters.slice(start).join('')
}

/** Retains a UTF-8 byte-bounded suffix while cursors remain monotonic. */
export class RawTerminalStream {
  private value = ''
  private begin = 0
  private revision = 0
  private closed = false
  private readonly listeners = new Set<() => void>()

  /**
   * @param maxRetainedBytes - maximum UTF-8 bytes retained across all readers.
   * @param maxReadBytes - maximum UTF-8 bytes returned by one read.
   */
  constructor(
    private readonly maxRetainedBytes: number,
    private readonly maxReadBytes: number,
  ) {}

  /**
   * Append one decoded raw VT chunk and wake pending readers.
   * @param data - decoded bytes in subprocess delivery order.
   */
  append(data: string): void {
    if (this.closed) return
    if (data.length === 0) return
    this.value += data
    if (Buffer.byteLength(this.value, 'utf8') > this.maxRetainedBytes) {
      const retained = utf8Tail(this.value, this.maxRetainedBytes)
      this.begin += this.value.length - retained.length
      this.value = retained
    }
    this.notify()
  }

  /** Permanently release current and future readers after the output stream ends. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.notify()
  }

  private notify(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  /**
   * Wait until output or the terminal's final state can advance a read.
   * @param cursor - prior result cursor, starting at zero.
   * @param signal - cancellation while the stream is idle.
   * @returns the bounded delta and next monotonic cursor.
   */
  async read(cursor: number, signal: AbortSignal): Promise<TerminalBackendStreamRead> {
    const first = this.snapshot(cursor)
    if (first.data.length > 0 || first.truncated || this.closed) return first
    const revision = this.revision
    await this.waitForChange(revision, signal)
    return this.snapshot(cursor)
  }

  /**
   * Read immediately for tests and for the pre-wait fast path.
   * @param cursor - prior result cursor, starting at zero.
   * @returns the bounded delta and next monotonic cursor.
   */
  snapshot(cursor: number): TerminalBackendStreamRead {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error('PTY stream cursor must be a non-negative safe integer')
    }
    const end = this.begin + this.value.length
    if (cursor > end) throw new Error('PTY stream cursor is ahead of retained output')
    const truncated = cursor < this.begin
    const effective = Math.max(cursor, this.begin)
    const data = utf8Head(this.value.slice(effective - this.begin), this.maxReadBytes)
    return { data, cursor: effective + data.length, truncated }
  }

  private waitForChange(revision: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true
        this.listeners.delete(onChange)
        signal.removeEventListener('abort', onAbort)
        if (error === undefined) resolve()
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- preserve the caller's exact AbortSignal.reason
        else reject(error)
      }
      const onChange = (): void => { finish() }
      const onAbort = (): void => { finish(signal.reason) }
      this.listeners.add(onChange)
      signal.addEventListener('abort', onAbort, { once: true })
      if (this.revision !== revision) finish()
    })
  }
}
