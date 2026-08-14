/**
 * DeepSeek Harness Electron main process: embeds the Cordis Host, owns native
 * capabilities, and exposes the fetch-shaped Host carrier through validated IPC.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { createWriteStream } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import { exposeAppModuleGraph } from './app-module-graph.ts'
import { hydrateDesktopLaunchEnvironment } from './launch-environment.ts'
import { exposePackagedExecutables } from './packaged-executables.ts'
import {
  ELECTRON_IPC_CHANNELS,
  type ElectronDesktopStatus,
  type ElectronFetchPortMessage,
  type ElectronFetchRequest,
} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-modules'
import { DirectoryPicker, type DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessagePortMain,
} from 'electron'
import {
  DESKTOP_SCHEME,
  contentTypeForDesktopAsset,
  desktopAppUrl,
  isDesktopAppDocumentUrl,
  resolveDesktopAppPath,
} from './desktop-protocol.ts'
import { isPlainRecord, parseFetchRequest, parseSessionExportFilename, parseSessionExportUrl } from './ipc-security.ts'

const SHUTDOWN_GRACE_MS = 8_000

protocol.registerSchemesAsPrivileged([{
  scheme: DESKTOP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}])

interface EmbeddedHost {
  readonly ctx: Context
  readonly shutdown: { shutdown(code: number): Promise<void> }
}

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: EmbeddedHost | undefined
let quitting: Promise<void> | undefined
let quitAllowed = false
let windowHiddenByUser = false

/** Electron-backed implementation of the existing native directory-picker service. */
class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly electronCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: signal => pickDirectory(signal),
  }

  /**
   * Return the stable Electron dialog capability.
   * @returns native directory picker.
   */
  capability(): DirectoryPickerCapability {
    return this.electronCapability
  }
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : 'This operation was aborted')
}

async function pickDirectory(signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) throw abortError(signal)
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return null
  let rejectAbort: ((reason: Error) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort?.(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await Promise.race([
      dialog.showOpenDialog(window, {
        title: 'Choose a workspace folder',
        defaultPath: app.getPath('home'),
        properties: ['openDirectory', 'createDirectory'],
      }),
      aborted,
    ])
    return result.canceled ? null : result.filePaths[0] ?? null
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function appAsset(relativePath: string): string {
  return join(app.getAppPath(), relativePath)
}

function webRootPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'web')
    : fileURLToPath(new URL('../../web/dist', import.meta.url))
}

function webRendererUrl(): string {
  return desktopAppUrl()
}

function preloadPath(): string {
  return fileURLToPath(new URL('./preload.cjs', import.meta.url))
}

function allowedRendererFiles(): Set<string> {
  return new Set([normalize(resolve(appAsset('ui/index.html')))])
}

function isAllowedRendererUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === `${DESKTOP_SCHEME}:`) return isDesktopAppDocumentUrl(url)
    if (url.protocol !== 'file:') return false
    return allowedRendererFiles().has(normalize(resolve(fileURLToPath(url))))
  } catch {
    return false
  }
}

function assertMainFrame(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow {
  const window = mainWindow
  if (window === undefined
    || window.isDestroyed()
    || event.sender !== window.webContents
    || event.senderFrame !== event.sender.mainFrame
    || !isAllowedRendererUrl(event.senderFrame.url)) {
    throw new Error('desktop IPC rejected a non-main-frame sender')
  }
  return window
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'DeepSeek Harness',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111113',
    icon: appAsset('build/icon.png'),
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
      : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  window.webContents.session.on('will-download', (event) => { event.preventDefault() })
  window.once('ready-to-show', () => {
    if (!windowHiddenByUser) window.show()
  })
  window.on('close', (event) => {
    if (quitting !== undefined || quitAllowed) return
    event.preventDefault()
    windowHiddenByUser = true
    window.hide()
  })
  void window.loadFile(appAsset('ui/index.html'))
  return window
}

function showMainWindow(): void {
  windowHiddenByUser = false
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createTray(): Tray {
  const path = appAsset(process.platform === 'darwin' ? 'build/trayTemplate.png' : 'build/icon.png')
  const icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) throw new Error(`desktop tray icon is empty: ${path}`)
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  const instance = new Tray(icon)
  instance.setToolTip('DeepSeek Harness')
  const menu = Menu.buildFromTemplate([
    { label: 'Show DeepSeek Harness', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit() } },
  ])
  instance.on('click', showMainWindow)
  if (process.platform === 'darwin') {
    instance.on('right-click', () => { instance.popUpContextMenu(menu) })
  } else {
    instance.setContextMenu(menu)
  }
  return instance
}

function sendStatus(status: ElectronDesktopStatus): void {
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  window.webContents.send(ELECTRON_IPC_CHANNELS.status, status)
}

function desktopManifest(): unknown {
  const runtime = host
  if (runtime === undefined) throw new Error('desktop Host is not ready')
  const graph = runtime.ctx.clientModules.graph()
  return {
    ...graph,
    entries: graph.entries.map(row => ({
      ...row,
      url: `${DESKTOP_SCHEME}://bundle/client.js?id=${encodeURIComponent(row.id)}&rev=${encodeURIComponent(row.rev)}`,
    })),
  }
}

async function handleDesktopRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.protocol !== `${DESKTOP_SCHEME}:`) {
    return new Response('not found', { status: 404 })
  }
  if (url.hostname === 'app') {
    const path = resolveDesktopAppPath(webRootPath(), url.pathname)
    if (path === undefined) return new Response('not found', { status: 404 })
    try {
      return new Response(await readFile(path), {
        headers: {
          'content-type': contentTypeForDesktopAsset(path),
          'cache-control': 'no-cache',
        },
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EISDIR') return new Response('not found', { status: 404 })
      return new Response(`asset read failed: ${String(error)}`, { status: 500 })
    }
  }
  if (url.hostname !== 'bundle' || url.pathname !== '/client.js') {
    return new Response('not found', { status: 404 })
  }
  const runtime = host
  if (runtime === undefined) return new Response('Host not ready', { status: 503 })
  const id = url.searchParams.get('id')
  if (url.searchParams.get('rev') === null) return new Response('not found', { status: 404 })
  const row = runtime.ctx.clientModules.graph().entries.find(entry => entry.id === id)
  if (row === undefined) return new Response('not found', { status: 404 })
  const path = runtime.ctx.clientModules.clientPath(row.id)
  if (path === undefined) return new Response('not found', { status: 404 })
  try {
    return new Response(await readFile(path), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
      },
    })
  } catch (error) {
    return new Response(`bundle read failed: ${String(error)}`, { status: 500 })
  }
}

class PullGate {
  private available = 0
  private waiter: (() => void) | undefined
  private stopped = false

  pull(): void {
    if (this.stopped) return
    if (this.waiter !== undefined) {
      const waiter = this.waiter
      this.waiter = undefined
      waiter()
      return
    }
    this.available += 1
  }

  stop(): void {
    this.stopped = true
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  async wait(): Promise<boolean> {
    if (this.stopped) return false
    if (this.available > 0) {
      this.available -= 1
      return true
    }
    await new Promise<void>((resolve) => { this.waiter = resolve })
    return !this.stopped
  }
}

function postPort(port: MessagePortMain, message: ElectronFetchPortMessage): void {
  port.postMessage(message)
}

async function dispatchFetch(
  event: IpcMainEvent,
  port: MessagePortMain,
  request: ElectronFetchRequest,
): Promise<void> {
  const runtime = host
  if (runtime === undefined) {
    postPort(port, { type: 'error', message: 'desktop Host is not ready' })
    port.close()
    return
  }
  const controller = new AbortController()
  const gate = new PullGate()
  const onPortMessage = ({ data }: { data: unknown }): void => {
    if (isPlainRecord(data) && data.type === 'pull') gate.pull()
    else if (isPlainRecord(data) && data.type === 'cancel') {
      controller.abort(new Error('renderer cancelled desktop fetch'))
      gate.stop()
    }
  }
  const onDestroyed = (): void => {
    controller.abort(new Error('renderer was destroyed'))
    gate.stop()
  }
  port.on('message', onPortMessage)
  port.start()
  event.sender.once('destroyed', onDestroyed)
  try {
    const response = await runtime.ctx.connection.fetch(new Request(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
    }))
    postPort(port, {
      type: 'head',
      head: {
        id: request.id,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      },
    })
    const reader = response.body?.getReader()
    if (reader === undefined) {
      postPort(port, { type: 'end' })
      return
    }
    try {
      while (await gate.wait()) {
        const next = await reader.read()
        if (next.done) {
          postPort(port, { type: 'end' })
          return
        }
        const bytes = next.value
        const value = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes.buffer
          : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        postPort(port, { type: 'chunk', value })
      }
    } finally {
      await reader.cancel().catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn('desktop fetch reader cancellation failed', error)
      })
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      postPort(port, { type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    gate.stop()
    event.sender.removeListener('destroyed', onDestroyed)
    port.removeListener('message', onPortMessage)
    port.close()
  }
}

function installIpc(): void {
  ipcMain.handle(ELECTRON_IPC_CHANNELS.manifest, (event) => {
    assertMainFrame(event)
    return desktopManifest()
  })
  ipcMain.on(ELECTRON_IPC_CHANNELS.fetch, (event, rawRequest: unknown) => {
    let port: MessagePortMain | undefined
    try {
      assertMainFrame(event)
      if (event.ports.length !== 1) throw new Error('desktop fetch requires one private MessagePort')
      port = event.ports[0]
      if (port === undefined) throw new Error('desktop fetch MessagePort is missing')
      const request = parseFetchRequest(rawRequest)
      void dispatchFetch(event, port, request)
    } catch (error) {
      if (port !== undefined) {
        postPort(port, { type: 'error', message: error instanceof Error ? error.message : String(error) })
        port.close()
      }
    }
  })
  ipcMain.handle(ELECTRON_IPC_CHANNELS.saveSessionExport, async (event, rawUrl: unknown, rawFilename: unknown) => {
    const window = assertMainFrame(event)
    await saveSessionExport(window, rawUrl, rawFilename)
  })
}

async function removePartialExport(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Could not remove partial Session export ${path}`, error)
    }
  }
}

async function saveSessionExport(window: BrowserWindow, rawUrl: unknown, rawFilename: unknown): Promise<void> {
  const runtime = host
  if (runtime === undefined) throw new Error('desktop Host is not ready')
  const url = parseSessionExportUrl(rawUrl)
  const filename = parseSessionExportFilename(rawFilename)
  const selection = await dialog.showSaveDialog(window, {
    title: 'Save session export',
    defaultPath: join(app.getPath('downloads'), filename),
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  })
  if (selection.canceled) return
  const response = await runtime.ctx.connection.fetch(new Request(url, { method: 'GET' }))
  if (!response.ok || response.body === null) {
    throw new Error(`Session export failed: HTTP ${String(response.status)}`)
  }
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(selection.filePath, { flags: 'w', mode: 0o600 }),
    )
  } catch (error) {
    await removePartialExport(selection.filePath)
    throw error
  }
}

async function bootEmbeddedHost(): Promise<void> {
  sendStatus({ state: 'loading', message: 'Starting the local runtime…' })
  const result = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    patchFiles: [],
    args: [],
    prepare: async (ctx) => { await ctx.plugin(ElectronDirectoryPicker) },
  })
  host = result
}

async function showApplication(): Promise<void> {
  await bootEmbeddedHost()
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  await window.loadURL(webRendererUrl())
  if (!windowHiddenByUser) {
    window.show()
    window.focus()
  }
}

async function beginQuit(): Promise<void> {
  if (quitting !== undefined) return quitting
  quitting = (async () => {
    const shutdown = host?.shutdown.shutdown(0)
    if (shutdown === undefined) {
      quitAllowed = true
      return
    }
    let timer: NodeJS.Timeout | undefined
    try {
      const timeout = Promise.withResolvers<true>()
      timer = setTimeout(timeout.resolve, SHUTDOWN_GRACE_MS, true)
      timer.unref()
      const timedOut = await Promise.race([
        shutdown.then(() => false),
        timeout.promise,
      ])
      if (timedOut) console.warn(`desktop Host did not stop within ${String(SHUTDOWN_GRACE_MS)} ms`)
    } catch (error) {
      console.error('desktop Host shutdown failed', error)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      quitAllowed = true
    }
  })()
  return quitting
}

function formatFailure(error: unknown): { message: string; detail: string } {
  if (error instanceof Error) return { message: error.message, detail: error.stack ?? error.message }
  return { message: String(error), detail: String(error) }
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => { showMainWindow() })
  app.on('activate', () => { showMainWindow() })
  app.on('will-quit', () => {
    tray?.destroy()
    tray = undefined
  })
  app.on('before-quit', (event) => {
    if (quitAllowed) return
    event.preventDefault()
    void beginQuit().then(() => { app.quit() })
  })
  app.on('window-all-closed', () => { app.quit() })

  await app.whenReady()
  await hydrateDesktopLaunchEnvironment()
  if (app.isPackaged) exposePackagedExecutables(process.resourcesPath)
  exposeAppModuleGraph(app.getAppPath())
  process.chdir(app.getPath('home'))
  mainWindow = createWindow()
  tray = createTray()
  installIpc()
  protocol.handle(DESKTOP_SCHEME, handleDesktopRequest)
  try {
    await showApplication()
  } catch (error) {
    const failure = formatFailure(error)
    console.error(inspect(error, { depth: null }))
    sendStatus({ state: 'error', message: 'The local runtime could not start.', detail: failure.detail })
  }
}

void main().catch((error: unknown) => {
  console.error(formatFailure(error).detail)
  app.exit(1)
})
