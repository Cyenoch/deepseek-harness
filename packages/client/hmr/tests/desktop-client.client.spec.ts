/** Electron client HMR observes manifest revisions and swaps the changed plugin fiber in place. */
import { Context } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

interface ManifestRow {
  id: string
  url: string
  rev: string
}

interface Manifest {
  rev: string
  entries: ManifestRow[]
}

const manifest = (graphRev: string, bundleRev: string): Manifest => ({
  rev: graphRev,
  entries: [{ id: 'pkg-a', url: `dsh://bundle/client.js?id=pkg-a&rev=${bundleRev}`, rev: bundleRev }],
})

afterEach(() => { vi.unstubAllGlobals() })

it('reloads a changed Electron client bundle without replacing the page', async () => {
  let current = manifest('graph-1', 'bundle-1')
  const readManifest = vi.fn(async (): Promise<Manifest> => current)
  vi.stubGlobal('__DSH_BOOT__', manifest('graph-boot', 'bundle-boot'))
  vi.stubGlobal('dshDesktop', { manifest: readManifest })
  vi.stubGlobal('document', { querySelectorAll: () => [] })

  const invalidate = vi.fn()
  const prefetch = vi.fn(async () => {})
  const refresh = vi.fn(async () => {})
  // Structural fakes cover only the methods the HMR client reads.
  const entry = { options: { name: 'pkg-a' }, refresh } as unknown as Entry
  const loader = { entries: () => [entry] } as unknown as Loader
  const modules = { invalidate, prefetch } as unknown as ClientModuleLoader

  const ctx = new Context()
  ctx.provide('loader', loader)
  ctx.provide('modules', modules)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await vi.waitFor(() => { expect(readManifest).toHaveBeenCalled() })
  expect(invalidate).not.toHaveBeenCalled()

  current = manifest('graph-2', 'bundle-2')
  await vi.waitFor(() => {
    expect(invalidate).toHaveBeenCalledWith('pkg-a')
    expect(prefetch).toHaveBeenCalledWith('pkg-a')
    expect(refresh).toHaveBeenCalledTimes(1)
  }, { timeout: 2_000 })

  await fiber.dispose()
  const callsAfterDispose = readManifest.mock.calls.length
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(readManifest).toHaveBeenCalledTimes(callsAfterDispose)
})
