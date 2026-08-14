/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list that mounts the desktop
 * interaction rows.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-desktop-app bundle', () => {
  it('declares a parseable patch list that mounts the desktop interaction rows', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      disabled?: boolean
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string }[]
    }[]
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows).toEqual([
      {
        id: 'directory-picker-surface',
        name: '@deepseek-ai/dsh-client-ui-directory-picker-native',
      },
      { id: 'desktop-runtime', name: '@deepseek-ai/dsh-desktop-app' },
    ])
    expect(patches.find(patch => patch.id === 'client-hmr')).toEqual({
      id: 'client-hmr',
      config: { transport: 'electron' },
    })
  })
})
