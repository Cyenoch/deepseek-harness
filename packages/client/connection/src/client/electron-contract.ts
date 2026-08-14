/**
 * Browser-safe Electron IPC contract shared by the preload bridge, desktop main process,
 * and Connection client. The renderer never receives Electron's ipcRenderer or MessagePort.
 */

/** Private channel names; only the preload and main process use them directly. */
export const ELECTRON_IPC_CHANNELS = {
  fetch: 'dsh:electron:fetch',
  manifest: 'dsh:electron:manifest',
  saveSessionExport: 'dsh:electron:save-session-export',
  status: 'dsh:electron:status',
} as const

/** One fetch request transferred from the isolated preload to Electron main. */
export interface ElectronFetchRequest {
  /** Renderer-minted opaque request id. */
  id: string
  /** Absolute internal URL; main accepts only the `http://dsh.internal` authority. */
  url: string
  /** HTTP method used by the fetch-shaped Host carrier. */
  method: string
  /** Normalized request headers. */
  headers: Record<string, string>
  /** String request body; all current client requests are JSON or bodyless. */
  body?: string
}

/** Response metadata delivered before body chunks. */
export interface ElectronFetchHead {
  id: string
  status: number
  statusText: string
  headers: Record<string, string>
}

/** Messages Electron main writes to the request's private MessagePort. */
export type ElectronFetchPortMessage =
  | { type: 'head'; head: ElectronFetchHead }
  | { type: 'chunk'; value: ArrayBuffer }
  | { type: 'end' }
  | { type: 'error'; message: string }

/** One preload-owned body read result exposed through the context bridge. */
export type ElectronFetchRead =
  | { done: true }
  | { done: false; value: ArrayBuffer }

/** Loading/error state shown by the local supervisor page. */
export type ElectronDesktopStatus =
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string; detail: string }

/** Native window chrome geometry selected by Electron main. */
export type ElectronWindowChrome = 'default' | 'macos-hidden-inset'

/** Narrow renderer interface exposed with contextBridge. */
export interface ElectronRendererBridge {
  /** Window chrome geometry the Web shell must reserve around native controls. */
  readonly windowChrome: ElectronWindowChrome
  /** Read the settled Host client-module graph. */
  manifest(): Promise<unknown>
  /** Open one Host fetch; body bytes are consumed through {@link readFetch}. */
  openFetch(request: ElectronFetchRequest): Promise<ElectronFetchHead>
  /** Read one response-body chunk, applying backpressure across the context bridge. */
  readFetch(id: string): Promise<ElectronFetchRead>
  /** Abort and forget one request. */
  cancelFetch(id: string): void
  /** Show the native save dialog and stream one exact Session export to the chosen file. */
  saveSessionExport(url: string, filename: string): Promise<void>
  /** Subscribe to loading-page state; returns an unsubscriber. */
  onStatus(listener: (status: ElectronDesktopStatus) => void): () => void
}

declare global {
  interface Window {
    /** Present only in the isolated Electron desktop renderer. */
    dshDesktop?: ElectronRendererBridge
  }
}
