/**
 * Recover exported login-shell variables for macOS GUI launches.
 * Finder and Dock start applications with a minimal environment, so their
 * PATH commonly omits package-manager and version-manager executables.
 * @module @deepseek-ai/dsh-desktop/launch-environment
 */

import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'
import { isAbsolute, delimiter } from 'node:path'

const START_MARKER = '__DSH_LOGIN_ENV_BEGIN__'
const END_MARKER = '__DSH_LOGIN_ENV_END__'
const PROBE_COMMAND = `printf '\\0${START_MARKER}\\0'; /usr/bin/env -0; printf '${END_MARKER}\\0'`
const SHELL_INTERNAL_NAMES = new Set(['_', 'DISABLE_AUTO_UPDATE', 'OLDPWD', 'PWD', 'SHLVL'])

type Environment = Record<string, string | undefined>

/** Run one login shell and return its NUL-delimited exported environment. */
function probeLoginShell(shell: string, environment: Environment): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(shell, ['-ilc', PROBE_COMMAND], {
      encoding: 'utf8',
      env: { ...environment, DISABLE_AUTO_UPDATE: 'true' },
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    }, (error, stdout) => {
      if (error !== null) reject(new Error(`login shell probe failed: ${error.message}`, { cause: error }))
      else resolve(stdout)
    })
  })
}

/**
 * Parse the marker-delimited environment emitted after shell startup output.
 * @param output - complete login-shell stdout.
 * @returns exported name/value entries between the probe markers.
 * @throws when the shell did not execute the fixed probe command completely.
 */
export function parseLoginShellEnvironment(output: string): Record<string, string> {
  const fields = output.split('\0')
  const start = fields.indexOf(START_MARKER)
  const end = fields.indexOf(END_MARKER, start + 1)
  if (start < 0 || end < 0) throw new Error('login shell did not return a complete environment probe')
  const result: Record<string, string> = {}
  for (const field of fields.slice(start + 1, end)) {
    const separator = field.indexOf('=')
    if (separator <= 0) continue
    result[field.slice(0, separator)] = field.slice(separator + 1)
  }
  return result
}

/**
 * Merge shell PATH entries after the launcher's existing entries.
 * @param inherited - PATH supplied directly to Electron.
 * @param discovered - PATH exported by the user's login shell.
 * @returns a de-duplicated PATH that preserves inherited lookup precedence.
 */
export function mergeExecutablePath(inherited: string | undefined, discovered: string): string {
  const entries = inherited === undefined
    ? discovered.split(delimiter)
    : [...inherited.split(delimiter), ...discovered.split(delimiter)]
  return [...new Set(entries)].join(delimiter)
}

/** Options used to isolate platform and process effects in tests. */
export interface DesktopLaunchEnvironmentOptions {
  /** Environment updated in place; defaults to `process.env`. */
  environment?: Environment
  /** Host platform; defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Login shell executable; defaults to `$SHELL`, then the user database. */
  shell?: string
  /** Injectable login-shell probe. */
  probe?: (shell: string, environment: Environment) => Promise<string>
  /** Non-fatal diagnostic sink. */
  warn?: (message: string, error?: unknown) => void
}

/**
 * Add missing exported login-shell variables to a packaged macOS launch.
 * Existing variables retain precedence; PATH additionally appends missing
 * login-shell directories so terminal and GUI launches resolve the same tools.
 * Other platforms already receive the desktop session's normal environment.
 * @param options - injectable environment, platform, shell, probe, and warning sink.
 * @returns after the probe is applied or a non-macOS/failing probe is skipped.
 */
export async function hydrateDesktopLaunchEnvironment(
  options: DesktopLaunchEnvironmentOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return
  const environment = options.environment ?? process.env
  const shell = options.shell ?? environment.SHELL ?? userInfo().shell
  const warn = options.warn ?? ((message: string, error?: unknown) => { console.warn(message, error) })
  if (shell === null || shell === '' || !isAbsolute(shell)) {
    warn(`desktop: cannot recover the login environment from non-absolute shell ${JSON.stringify(shell)}`)
    return
  }
  try {
    const discovered = parseLoginShellEnvironment(await (options.probe ?? probeLoginShell)(shell, environment))
    for (const [name, value] of Object.entries(discovered)) {
      if (SHELL_INTERNAL_NAMES.has(name)) continue
      if (name === 'PATH') environment.PATH = mergeExecutablePath(environment.PATH, value)
      else if (environment[name] === undefined) environment[name] = value
    }
  } catch (error) {
    warn('desktop: could not recover the login-shell environment; keeping the inherited environment', error)
  }
}
