import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exposeAppModuleGraph } from '../src/app-module-graph.ts'

const previousNodePath = process.env.NODE_PATH

function restoreNodePath(): void {
  if (previousNodePath === undefined) delete process.env.NODE_PATH
  else process.env.NODE_PATH = previousNodePath
  ;(Module as typeof Module & { _initPaths(): void })._initPaths()
}

afterEach(restoreNodePath)

function writePackage(dir: string, name: string, marker: string): void {
  const root = join(dir, 'node_modules', name)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
  writeFileSync(join(root, 'index.js'), `module.exports = ${JSON.stringify(marker)}\n`)
}

describe('exposeAppModuleGraph', () => {
  it('lets profile-anchored createRequire find app-owned packages after the parent walk', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-app-module-graph-'))
    const appPath = join(root, 'app')
    const profileDir = join(root, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    writePackage(appPath, 'dsh-app-owned-probe', 'from-app')
    delete process.env.NODE_PATH
    exposeAppModuleGraph(appPath)
    const appModules = join(appPath, 'node_modules')
    expect(process.env.NODE_PATH).toBe(appModules)
    process.env.NODE_PATH = ''
    exposeAppModuleGraph(appPath)
    expect(process.env.NODE_PATH).toBe(appModules)

    const require = createRequire(join(profileDir, '__cordis_loader__.cjs'))
    expect(realpathSync(require.resolve('dsh-app-owned-probe'))).toBe(realpathSync(join(appModules, 'dsh-app-owned-probe', 'index.js')))
    expect(require('dsh-app-owned-probe')).toBe('from-app')
  })

  it('keeps a profile-local package ahead of the application graph', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-app-module-graph-'))
    const appPath = join(root, 'app')
    const profileDir = join(root, 'profiles', 'desktop')
    writePackage(appPath, 'dsh-app-owned-probe', 'from-app')
    writePackage(profileDir, 'dsh-app-owned-probe', 'from-profile')
    process.env.NODE_PATH = join(root, 'other-modules')
    exposeAppModuleGraph(appPath)

    const require = createRequire(join(profileDir, '__cordis_loader__.cjs'))
    expect(require('dsh-app-owned-probe')).toBe('from-profile')
    expect(process.env.NODE_PATH).toBe(
      `${join(appPath, 'node_modules')}${delimiter}${join(root, 'other-modules')}`,
    )
  })
})
