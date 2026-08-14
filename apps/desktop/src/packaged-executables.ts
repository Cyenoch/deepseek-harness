/**
 * Resolve executable assets that electron-builder moves out of `app.asar`.
 * JavaScript package resolution still reports virtual archive paths, while
 * direct subprocess spawning needs the corresponding physical files under
 * `app.asar.unpacked`.
 * @module @deepseek-ai/dsh-desktop/packaged-executables
 */

import { join } from 'node:path'

/**
 * Resolve the packaged ripgrep executable for one Electron target.
 * @param resourcesPath - Electron `process.resourcesPath`.
 * @param platform - packaged target platform.
 * @param arch - packaged target architecture.
 * @returns physical ripgrep path outside the ASAR archive.
 */
export function packagedRipgrepPath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@vscode',
    `ripgrep-${platform}-${arch}`,
    'bin',
    platform === 'win32' ? 'rg.exe' : 'rg',
  )
}

/**
 * Resolve the packaged Linux Landlock launcher.
 * @param resourcesPath - Electron `process.resourcesPath`.
 * @param arch - packaged target architecture.
 * @returns physical launcher path outside the ASAR archive.
 */
export function packagedLandlockPath(
  resourcesPath: string,
  arch: string = process.arch,
): string {
  return join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@deepseek-ai',
    `node-addon-landlock-run-linux-${arch}`,
    'bin',
    'landlock-run',
  )
}

/**
 * Publish physical packaged-executable paths before the Host module graph
 * loads. Explicit deployment overrides retain precedence.
 * @param resourcesPath - Electron `process.resourcesPath`.
 * @param platform - running packaged platform.
 * @param arch - running packaged architecture.
 */
export function exposePackagedExecutables(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): void {
  if (process.env.DSH_RIPGREP_PATH === undefined) {
    process.env.DSH_RIPGREP_PATH = packagedRipgrepPath(resourcesPath, platform, arch)
  }
  if (platform === 'linux' && !process.env.DSH_LANDLOCK_RUN_PATH?.trim()) {
    process.env.DSH_LANDLOCK_RUN_PATH = packagedLandlockPath(resourcesPath, arch)
  }
}
