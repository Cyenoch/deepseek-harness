/**
 * Temporary-repository setup for script specs that write isolated package trees.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'

/**
 * Owns one suite's temporary repository roots and removes them after each test.
 */
export class RepositoryFixture {
  private readonly roots: string[] = []

  constructor() {
    afterEach(() => {
      for (const root of this.roots.splice(0)) rmSync(root, { recursive: true, force: true })
    })
  }

  /**
   * Create a unique temporary directory tracked for afterEach cleanup.
   * @param prefix - `mkdtempSync` prefix, typically `dsh-<suite>-`.
   * @returns the new repository root.
   */
  create(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix))
    this.roots.push(root)
    return root
  }

  /**
   * Write a JSON object as a repository-relative file, creating parent directories.
   * @param root - fixture root from {@link create}.
   * @param file - path relative to `root`.
   * @param manifest - JSON-serializable object.
   */
  writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(manifest)}\n`)
  }
}
