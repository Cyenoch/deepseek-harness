// Built Electron carrier: launch the real desktop main process, wait for its
// embedded Host to replace the local supervisor page, snapshot the assembled
// client, hide the native window, then explicitly quit through the Host shutdown path.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication, Page } from 'playwright'
import { _electron as electron } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { REPO_ROOT, requireDist, saveFailureShot } from './support.ts'

const DESKTOP_ROOT = join(REPO_ROOT, 'apps/desktop')
const DESKTOP_MAIN = join(DESKTOP_ROOT, 'lib/main.js')
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-profile', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const desktopRequire = createRequire(join(DESKTOP_ROOT, 'package.json'))

function requireDesktopBuild(): void {
  if (!existsSync(DESKTOP_MAIN)) {
    throw new Error('built Electron desktop main missing — run `pnpm --dir apps/desktop run build:code`')
  }
}

function waitForExit(application: ElectronApplication): Promise<number> {
  const child = application.process()
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  const { promise, resolve, reject } = Promise.withResolvers<number>()
  const timer = setTimeout(() => { reject(new Error('Electron desktop did not exit after explicit quit')) }, 15_000)
  child.once('exit', (code) => {
    clearTimeout(timer)
    resolve(code ?? -1)
  })
  return promise
}

describe('web e2e: shipped Electron desktop carrier', () => {
  let home: string | undefined
  let workspace: string | undefined
  let shellBin: string | undefined
  let application: ElectronApplication | undefined
  let page: Page
  let tripwire: { warnings: string[]; pageErrors: string[] }

  beforeAll(async () => {
    requireDist()
    requireDesktopBuild()
    home = await mkdtemp(join(tmpdir(), 'dsh-electron-home-'))
    workspace = await mkdtemp(join(tmpdir(), 'dsh-electron-workspace-'))
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    delete env.DEEPSEEK_BASE_URL
    env.DEEPSEEK_API_KEY = 'dsh-electron-dummy-key'
    env.DSH_HOME = home
    env.DSH_AGENTS_HOME = join(workspace, '.agents')
    env.DSH_TELEMETRY_DISABLED = '1'
    env.LANG = 'en_US.UTF-8'
    env.LC_ALL = 'en_US.UTF-8'
    env.LANGUAGE = 'en'
    if (process.platform === 'darwin') {
      shellBin = join(home, 'login-shell-bin')
      mkdirSync(shellBin)
      writeFileSync(join(home, '.zprofile'), `export PATH="$PATH:${shellBin}"\nexport DESKTOP_SHELL_ENV_PROBE=ready\n`)
      env.SHELL = '/bin/zsh'
      env.ZDOTDIR = home
      env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
    }

    application = await electron.launch({
      executablePath: desktopRequire('electron') as string,
      args: ['--lang=en-US', DESKTOP_ROOT],
      cwd: DESKTOP_ROOT,
      env,
    })
    page = await application.firstWindow()
    tripwire = watchConsole(page)
    await page.waitForSelector('#root [class*="frame"]', { timeout: 90_000 })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    if (application !== undefined && application.process().exitCode === null) {
      await application.close().catch((error: unknown) => { failures.push(error) })
    }
    if (home !== undefined) await rm(home, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
    if (failures.length > 0) throw new AggregateError(failures, 'Electron desktop teardown failed')
  })

  it('keeps the embedded Host running after close and exits cleanly on explicit quit', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-electron-desktop'))
    if (application === undefined || workspace === undefined) throw new Error('Electron desktop was not started')
    if (process.platform === 'darwin') {
      const launchEnvironment = await application.evaluate(() => ({
        path: process.env.PATH,
        shellExport: process.env.DESKTOP_SHELL_ENV_PROBE,
      }))
      expect(launchEnvironment.path?.split(':')).toContain(shellBin)
      expect(launchEnvironment.shellExport).toBe('ready')
      const layout = await application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (window === undefined) throw new Error('Electron desktop window is missing')
        return {
          bounds: window.getBounds(),
          contentBounds: window.getContentBounds(),
        }
      })
      expect(layout.contentBounds).toEqual(layout.bounds)
      expect(await page.locator('html').getAttribute('data-dsh-window-chrome')).toBe('macos-hidden-inset')
    }
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const snapshot = await captureStableAria(page, '#root', workspace)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await expect.poll(async () => application?.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return window !== undefined && !window.isVisible() && !window.isDestroyed()
    })).toBe(true)
    expect(application.process().exitCode).toBeNull()

    const exited = waitForExit(application)
    await application.evaluate(({ app }) => {
      setTimeout(() => { app.quit() }, 0)
    })
    expect(await exited).toBe(0)
  })
})
