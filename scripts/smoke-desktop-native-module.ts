/** Smoke the packaged Electron runtime's node-pty prebuild. */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MARKER = 'desktop-native-ok'
const SMOKE_PROGRAM = String.raw`
const { spawn } = require(process.argv[1])
const shell = process.argv[2]
const args = JSON.parse(process.argv[3])
const marker = process.argv[4]
const terminal = spawn(shell, args, { cols: 80, rows: 24, env: process.env })
let output = ''
let settled = false
const timeout = setTimeout(() => finish(1, 'timed out'), 10_000)
terminal.onData(data => { output += data })
terminal.onExit(({ exitCode }) => finish(exitCode, 'exited'))
function finish(exitCode, reason) {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  if (exitCode === 0 && output.includes(marker)) {
    process.stdout.write(marker)
    process.exit(0)
  }
  process.stderr.write('node-pty ' + reason + ' with code ' + exitCode + ': ' + output)
  process.exit(1)
}
`

type DesktopTarget = 'macos-arm64' | 'windows-x64'

interface NativeSmokeSpec {
  readonly executable: string
  readonly appAsar: string
  readonly nodePty: string
  readonly shell: string
  readonly shellArgs: readonly string[]
}

/**
 * Resolve the packaged executable and virtual ASAR module path for one target.
 * @param target - Desktop workflow matrix target.
 * @param outputDirectory - electron-builder output directory.
 * @returns paths and shell command used by the packaged runtime smoke.
 */
function resolveNativeSmokeSpec(target: DesktopTarget, outputDirectory: string): NativeSmokeSpec {
  const root = resolve(outputDirectory)
  if (target === 'macos-arm64') {
    const resources = resolve(root, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'Resources')
    return {
      executable: resolve(root, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS', 'DeepSeek Harness'),
      appAsar: resolve(resources, 'app.asar'),
      nodePty: resolve(resources, 'app.asar', 'node_modules', 'node-pty'),
      shell: '/bin/sh',
      shellArgs: ['-c', `printf ${MARKER}`],
    }
  }
  const resources = resolve(root, 'win-unpacked', 'resources')
  return {
    executable: resolve(root, 'win-unpacked', 'DeepSeek Harness.exe'),
    appAsar: resolve(resources, 'app.asar'),
    nodePty: resolve(resources, 'app.asar', 'node_modules', 'node-pty'),
    shell: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
    shellArgs: ['/d', '/s', '/c', `echo ${MARKER}`],
  }
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const target = readFlag('target')
  const outputDirectory = process.argv.slice(2).find(arg => !arg.startsWith('--'))
  if ((target !== 'macos-arm64' && target !== 'windows-x64') || outputDirectory === undefined) {
    throw new Error('usage: smoke-desktop-native-module --target=<macos-arm64|windows-x64> <output-directory>')
  }

  const spec = resolveNativeSmokeSpec(target, outputDirectory)
  for (const path of [spec.executable, spec.appAsar]) {
    if (!existsSync(path)) throw new Error(`desktop native smoke: missing ${path}`)
  }

  const result = spawnSync(spec.executable, [
    '-e',
    SMOKE_PROGRAM,
    spec.nodePty,
    spec.shell,
    JSON.stringify(spec.shellArgs),
    MARKER,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 || !result.stdout.includes(MARKER)) {
    throw new Error(`desktop native smoke failed with status ${String(result.status)}: ${result.stderr || result.stdout}`)
  }
  console.log(`${target}: ${MARKER}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
