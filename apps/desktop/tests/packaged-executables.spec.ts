import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exposePackagedExecutables,
  packagedLandlockPath,
  packagedRipgrepPath,
} from '../src/packaged-executables.ts'

const previousRipgrepPath = process.env.DSH_RIPGREP_PATH
const previousLandlockPath = process.env.DSH_LANDLOCK_RUN_PATH

afterEach(() => {
  if (previousRipgrepPath === undefined) delete process.env.DSH_RIPGREP_PATH
  else process.env.DSH_RIPGREP_PATH = previousRipgrepPath
  if (previousLandlockPath === undefined) delete process.env.DSH_LANDLOCK_RUN_PATH
  else process.env.DSH_LANDLOCK_RUN_PATH = previousLandlockPath
})

describe('packaged executable paths', () => {
  it('maps macOS ripgrep to its unpacked platform package', () => {
    expect(packagedRipgrepPath('/desktop/resources', 'darwin', 'arm64')).toBe(join(
      '/desktop/resources',
      'app.asar.unpacked',
      'node_modules',
      '@vscode',
      'ripgrep-darwin-arm64',
      'bin',
      'rg',
    ))
  })

  it('maps Windows ripgrep to rg.exe', () => {
    expect(packagedRipgrepPath('C:\\resources', 'win32', 'x64')).toBe(join(
      'C:\\resources',
      'app.asar.unpacked',
      'node_modules',
      '@vscode',
      'ripgrep-win32-x64',
      'bin',
      'rg.exe',
    ))
  })

  it('maps Linux Landlock to its unpacked platform package', () => {
    expect(packagedLandlockPath('/desktop/resources', 'x64')).toBe(join(
      '/desktop/resources',
      'app.asar.unpacked',
      'node_modules',
      '@deepseek-ai',
      'node-addon-landlock-run-linux-x64',
      'bin',
      'landlock-run',
    ))
  })

  it('publishes only target-relevant unset overrides', () => {
    delete process.env.DSH_RIPGREP_PATH
    delete process.env.DSH_LANDLOCK_RUN_PATH
    exposePackagedExecutables('/desktop/resources', 'darwin', 'arm64')
    expect(process.env.DSH_RIPGREP_PATH).toBe(packagedRipgrepPath('/desktop/resources', 'darwin', 'arm64'))
    expect(process.env.DSH_LANDLOCK_RUN_PATH).toBeUndefined()

    delete process.env.DSH_RIPGREP_PATH
    exposePackagedExecutables('/desktop/resources', 'linux', 'x64')
    expect(process.env.DSH_RIPGREP_PATH).toBe(packagedRipgrepPath('/desktop/resources', 'linux', 'x64'))
    expect(process.env.DSH_LANDLOCK_RUN_PATH).toBe(packagedLandlockPath('/desktop/resources', 'x64'))
  })

  it('preserves explicit operator overrides', () => {
    process.env.DSH_RIPGREP_PATH = '/operator/rg'
    process.env.DSH_LANDLOCK_RUN_PATH = '/operator/landlock-run'
    exposePackagedExecutables('/desktop/resources', 'linux', 'arm64')
    expect(process.env.DSH_RIPGREP_PATH).toBe('/operator/rg')
    expect(process.env.DSH_LANDLOCK_RUN_PATH).toBe('/operator/landlock-run')
  })

  it('treats a blank Landlock value as unset, matching the launcher contract', () => {
    process.env.DSH_RIPGREP_PATH = '/operator/rg'
    process.env.DSH_LANDLOCK_RUN_PATH = '   '
    exposePackagedExecutables('/desktop/resources', 'linux', 'x64')
    expect(process.env.DSH_LANDLOCK_RUN_PATH).toBe(packagedLandlockPath('/desktop/resources', 'x64'))
  })
})
