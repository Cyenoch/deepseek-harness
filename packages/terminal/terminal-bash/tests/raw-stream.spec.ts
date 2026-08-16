import { describe, expect, it } from 'vitest'
import { RawTerminalStream } from '@deepseek-ai/dsh-terminal-bash/src/raw-stream.ts'

describe('RawTerminalStream', () => {
  it('returns bounded UTF-8 deltas with monotonic cursors and truncation', () => {
    const stream = new RawTerminalStream(6, 4)
    stream.append('ab€cd')

    expect(stream.snapshot(0)).toEqual({ data: 'b€', cursor: 3, truncated: true })
    expect(stream.snapshot(3)).toEqual({ data: 'cd', cursor: 5, truncated: false })
    expect(() => stream.snapshot(-1)).toThrow('non-negative safe integer')
    expect(() => stream.snapshot(6)).toThrow('ahead of retained output')
  })

  it('releases every pending read for output and preserves the abort reason', async () => {
    const stream = new RawTerminalStream(100, 100)
    const signal = new AbortController().signal
    const first = stream.read(0, signal)
    const second = stream.read(0, signal)
    stream.append('\u001b[31mred')
    await expect(first).resolves.toEqual({ data: '\u001b[31mred', cursor: 8, truncated: false })
    await expect(second).resolves.toEqual({ data: '\u001b[31mred', cursor: 8, truncated: false })

    const controller = new AbortController()
    const cancelled = stream.read(8, controller.signal)
    const reason = new Error('view disposed')
    controller.abort(reason)
    await expect(cancelled).rejects.toBe(reason)
  })

  it('releases a pending read when the stream closes', async () => {
    const stream = new RawTerminalStream(100, 100)
    const pending = stream.read(0, new AbortController().signal)
    stream.close()
    await expect(pending).resolves.toEqual({ data: '', cursor: 0, truncated: false })
  })

  it('returns immediately for readers that begin after stream closure', async () => {
    const stream = new RawTerminalStream(100, 100)
    stream.close()
    await expect(stream.read(0, new AbortController().signal)).resolves.toEqual({
      data: '',
      cursor: 0,
      truncated: false,
    })
    stream.append('late output')
    expect(stream.snapshot(0).data).toBe('')
  })
})
