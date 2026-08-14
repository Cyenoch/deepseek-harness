/**
 * Desktop development supervisor: keeps every client-plugin bundle in watch mode
 * while one Electron process owns the embedded Host. Client rebuilds are consumed
 * by the desktop HMR carrier; main/preload changes still require restarting this command.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { TsdownBundle } from 'tsdown'
import { discoverPluginDirs, watchClientPlugins } from './dev-web.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const desktopRoot = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url))

interface ChildOutcome {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

function childOutcome(child: ChildProcess): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
}

async function disposeBundles(bundles: readonly TsdownBundle[]): Promise<void> {
  await Promise.all(bundles.map(async bundle => bundle[Symbol.asyncDispose]()))
}

async function main(): Promise<void> {
  const pluginDirs = discoverPluginDirs(repoRoot)
  if (pluginDirs.length === 0) {
    throw new Error('dev-desktop: no dsh.client (platform "web") packages found under packages/')
  }

  const bundles = await watchClientPlugins(repoRoot, pluginDirs, 500)
  console.log(`dev-desktop: watching ${String(pluginDirs.length)} client-plugin packages`)

  const electronCli = desktopRequire.resolve('electron/cli.js')
  const child = spawn(process.execPath, [electronCli, '.'], {
    cwd: desktopRoot,
    stdio: 'inherit',
    env: process.env,
  })
  const outcome = childOutcome(child)
  let requestedSignal: NodeJS.Signals | undefined
  const stop = (signal: NodeJS.Signals): void => {
    if (requestedSignal !== undefined) return
    requestedSignal = signal
    child.kill(signal)
  }
  const onInterrupt = (): void => { stop('SIGINT') }
  const onTerminate = (): void => { stop('SIGTERM') }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)

  try {
    const result = await outcome
    if (requestedSignal === undefined) {
      process.exitCode = result.code ?? 1
    } else {
      process.exitCode = requestedSignal === 'SIGINT' ? 130 : 143
    }
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    await disposeBundles(bundles)
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
