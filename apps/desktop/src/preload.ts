/**
 * Sandboxed Electron preload: exposes a narrow fetch/body/save interface while
 * keeping ipcRenderer and MessagePort objects out of the page world.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import {
  ELECTRON_IPC_CHANNELS,
  type ElectronDesktopStatus,
  type ElectronFetchHead,
  type ElectronFetchPortMessage,
  type ElectronFetchRead,
  type ElectronFetchRequest,
  type ElectronRendererBridge,
} from '@deepseek-ai/dsh-client-connection/electron'
import { contextBridge, ipcRenderer } from 'electron'

interface PendingRead {
  resolve(value: ElectronFetchRead): void
  reject(reason: Error): void
}

interface FetchState {
  readonly port: MessagePort
  readonly head: Promise<ElectronFetchHead>
  resolveHead(value: ElectronFetchHead): void
  rejectHead(reason: Error): void
  headSettled: boolean
  pending: PendingRead | undefined
  ended: boolean
  error: Error | undefined
}

const fetches = new Map<string, FetchState>()

function errorOf(message: unknown): Error {
  return new Error(typeof message === 'string' ? message : 'Electron Host carrier failed')
}

function settleError(id: string, state: FetchState, error: Error): void {
  state.error = error
  state.ended = true
  if (!state.headSettled) {
    state.headSettled = true
    state.rejectHead(error)
  }
  state.pending?.reject(error)
  state.pending = undefined
  state.port.close()
  fetches.delete(id)
}

function receivePortMessage(id: string, state: FetchState, raw: unknown): void {
  const message = raw as ElectronFetchPortMessage
  switch (message.type) {
    case 'head':
      if (state.headSettled) {
        settleError(id, state, new Error('Electron Host carrier sent duplicate response metadata'))
        return
      }
      state.headSettled = true
      state.resolveHead(message.head)
      return
    case 'chunk': {
      const pending = state.pending
      if (pending === undefined) {
        settleError(id, state, new Error('Electron Host carrier sent an unsolicited body chunk'))
        return
      }
      state.pending = undefined
      pending.resolve({ done: false, value: message.value })
      return
    }
    case 'end':
      state.ended = true
      state.pending?.resolve({ done: true })
      state.pending = undefined
      state.port.close()
      fetches.delete(id)
      return
    case 'error':
      settleError(id, state, errorOf(message.message))
      return
    default:
      settleError(id, state, new Error('Electron Host carrier sent an unknown port message'))
  }
}

function openFetch(request: ElectronFetchRequest): Promise<ElectronFetchHead> {
  if (fetches.has(request.id)) return Promise.reject(new Error('Electron fetch request id is already active'))
  const channel = new MessageChannel()
  let resolveHead!: (value: ElectronFetchHead) => void
  let rejectHead!: (reason: Error) => void
  const head = new Promise<ElectronFetchHead>((resolve, reject) => {
    resolveHead = resolve
    rejectHead = reject
  })
  const state: FetchState = {
    port: channel.port1,
    head,
    resolveHead,
    rejectHead,
    headSettled: false,
    pending: undefined,
    ended: false,
    error: undefined,
  }
  channel.port1.onmessage = (event) => { receivePortMessage(request.id, state, event.data) }
  channel.port1.onmessageerror = () => {
    settleError(request.id, state, new Error('Electron Host carrier could not deserialize a port message'))
  }
  channel.port1.start()
  fetches.set(request.id, state)
  ipcRenderer.postMessage(ELECTRON_IPC_CHANNELS.fetch, request, [channel.port2])
  return head
}

function readFetch(id: string): Promise<ElectronFetchRead> {
  const state = fetches.get(id)
  if (state === undefined) return Promise.resolve({ done: true })
  if (state.error !== undefined) return Promise.reject(state.error)
  if (state.ended) return Promise.resolve({ done: true })
  if (!state.headSettled) return Promise.reject(new Error('Electron fetch body was read before response metadata'))
  if (state.pending !== undefined) return Promise.reject(new Error('Electron fetch body already has a pending read'))
  return new Promise<ElectronFetchRead>((resolve, reject) => {
    state.pending = { resolve, reject }
    state.port.postMessage({ type: 'pull' })
  })
}

function cancelFetch(id: string): void {
  const state = fetches.get(id)
  if (state === undefined) return
  state.port.postMessage({ type: 'cancel' })
  settleError(id, state, new Error('Electron fetch was cancelled'))
}

const bridge: ElectronRendererBridge = {
  windowChrome: process.platform === 'darwin' ? 'macos-hidden-inset' : 'default',
  manifest: () => ipcRenderer.invoke(ELECTRON_IPC_CHANNELS.manifest) as Promise<unknown>,
  openFetch,
  readFetch,
  cancelFetch,
  saveSessionExport: (url, filename) =>
    ipcRenderer.invoke(ELECTRON_IPC_CHANNELS.saveSessionExport, url, filename) as Promise<void>,
  onStatus: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, status: ElectronDesktopStatus): void => { listener(status) }
    ipcRenderer.on(ELECTRON_IPC_CHANNELS.status, receive)
    return () => { ipcRenderer.removeListener(ELECTRON_IPC_CHANNELS.status, receive) }
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
