/**
 * Failure-path tests for the lazy packaged-ripgrep resolution. The success
 * path (the real `@vscode/ripgrep` module) is exercised throughout
 * tools.spec.ts; here the module is mocked to throw at evaluation, proving a
 * missing or corrupt platform package (`--omit=optional`, partial install)
 * surfaces as a per-call `SEARCH_FAILED` — not a composition-load failure.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveRgPath, runRipgrep } from '@deepseek-ai/dsh-tool-fs-search'

// Any access to the mocked module's surface throws — the shape a missing
// platform package produces at module evaluation.
vi.mock('@vscode/ripgrep', () => new Proxy({}, {
  get() {
    throw new Error('platform package @vscode/ripgrep-win32-x64 is not installed')
  },
}))

describe('lazy packaged-ripgrep resolution', () => {
  const previous = process.env.DSH_RIPGREP_PATH

  afterEach(() => {
    if (previous === undefined) delete process.env.DSH_RIPGREP_PATH
    else process.env.DSH_RIPGREP_PATH = previous
  })

  it('fails the first search call with SEARCH_FAILED instead of failing module load', async () => {
    delete process.env.DSH_RIPGREP_PATH
    // The resolution rejects before any spawn, so no subprocess service is needed.
    const controller = new AbortController()
    const exec = { signal: controller.signal, name: 'glob', callId: CallId('missing-platform-package') } as unknown as ToolExecution

    await expect(runRipgrep(new Context(), exec, 'glob', ['--files'], 1_000_000, 3_000, 64 * 1024))
      .rejects.toMatchObject({ name: 'SearchError', code: 'SEARCH_FAILED' })
  })

  it('keeps failing every subsequent call (the resolution is memoized)', async () => {
    delete process.env.DSH_RIPGREP_PATH
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
  })
})

describe('DSH_RIPGREP_PATH override', () => {
  const previous = process.env.DSH_RIPGREP_PATH

  afterEach(() => {
    if (previous === undefined) delete process.env.DSH_RIPGREP_PATH
    else process.env.DSH_RIPGREP_PATH = previous
  })

  it('uses an absolute regular file and never falls back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rg-path-'))
    const configured = join(dir, 'rg')
    writeFileSync(configured, 'rg')
    process.env.DSH_RIPGREP_PATH = configured
    await expect(resolveRgPath()).resolves.toBe(configured)
    rmSync(dir, { recursive: true, force: true })
  })

  it('fails loud for a missing, relative, or non-file configured path', async () => {
    process.env.DSH_RIPGREP_PATH = join(tmpdir(), 'dsh-rg-missing', 'rg')
    await expect(resolveRgPath()).rejects.toThrow(/DSH_RIPGREP_PATH/)
    process.env.DSH_RIPGREP_PATH = 'relative/rg'
    await expect(resolveRgPath()).rejects.toThrow(/DSH_RIPGREP_PATH/)
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rg-dir-'))
    process.env.DSH_RIPGREP_PATH = dir
    await expect(resolveRgPath()).rejects.toThrow(/DSH_RIPGREP_PATH/)
    rmSync(dir, { recursive: true, force: true })
  })
})
