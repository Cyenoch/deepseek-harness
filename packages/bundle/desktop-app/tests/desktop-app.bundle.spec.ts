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
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

function readPatches(path: string): PatchOptions[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError(`${path} must contain a patch list`)
  return parsed as PatchOptions[]
}

describe('dsh-desktop-app bundle', () => {
  it('declares a parseable patch list that mounts the desktop interaction rows', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = readPatches(resolve(root, manifest.dsh!.bundle!.patch!))
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
      inject: ['desktopRuntime'],
      config: { transport: 'electron' },
    })
    expect(patches.find(patch => patch.id === 'modules')).toEqual({
      id: 'modules',
      inject: ['desktopRuntime'],
    })
  })

  it('replaces Web-only activation ordering in the composed desktop profile', () => {
    const webPatches = readPatches(resolve(root, '../web-app/cordis.patch.yml'))
    const desktopPatches = readPatches(resolve(root, 'cordis.patch.yml'))
    const entries = applyEntryPatches([], [...webPatches, ...desktopPatches], () => {})

    expect(entries.find(entry => entry.id === 'webserver')?.disabled).toBe(true)
    expect(entries.find(entry => entry.id === 'modules')?.inject).toEqual(['desktopRuntime'])
    expect(entries.find(entry => entry.id === 'client-hmr')?.inject).toEqual(['desktopRuntime'])
  })
})
