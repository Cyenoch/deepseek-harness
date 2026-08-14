/**
 * Fetch-shaped Electron renderer carrier over the isolated preload bridge.
 * @module @deepseek-ai/dsh-client-connection/client/electron-api-client
 */

import type { ElectronFetchRequest, ElectronRendererBridge } from './electron-contract.ts'
import { AbstractApiClient } from './api.ts'

/** Host Connection origin accepted by desktop IPC validation. */
export const INTERNAL_HOST_ORIGIN = 'http://dsh.internal'

/**
 * Read the isolated preload bridge from the desktop renderer global.
 * @returns the bridge inside Electron, otherwise `undefined`.
 */
export function electronBridge(): ElectronRendererBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.dshDesktop
}

/**
 * Resolve a renderer fetch onto the internal Host origin when it targets
 * that origin or the privileged desktop document origin.
 * @param input - fetch input resolved by the page or already absolute.
 * @param pageOrigin - `location.origin` of the desktop document, if any.
 * @returns the internal Host URL, or `undefined` when the request is not Host-bound.
 */
export function rewriteDesktopFetchUrl(
  input: RequestInfo | URL,
  pageOrigin: string | undefined,
): URL | undefined {
  const absolute = input instanceof Request
    ? new URL(input.url)
    : new URL(String(input), INTERNAL_HOST_ORIGIN)
  if (absolute.origin === INTERNAL_HOST_ORIGIN) return absolute
  if (pageOrigin === undefined) return undefined
  let page: URL
  try {
    page = new URL(pageOrigin)
  } catch {
    return undefined
  }
  if (absolute.protocol === page.protocol && absolute.hostname === page.hostname) {
    return new URL(`${absolute.pathname}${absolute.search}`, INTERNAL_HOST_ORIGIN)
  }
  return undefined
}

/**
 * Convert one ordinary fetch call into the preload bridge's head/body protocol.
 * @param bridge - isolated preload interface.
 * @param input - absolute internal request target or Request.
 * @param init - fetch request metadata and cancellation.
 * @returns a standard Response whose body pulls chunks from preload on demand.
 */
export async function electronFetch(
  bridge: ElectronRendererBridge,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const normalized = new Request(input, init)
  const id = crypto.randomUUID()
  const signal = normalized.signal
  if (signal.aborted) throw abortError(signal)
  const body = normalized.body === null ? undefined : await normalized.text()
  if (isAborted(signal)) throw abortError(signal)
  const request: ElectronFetchRequest = {
    id,
    url: normalized.url,
    method: normalized.method,
    headers: Object.fromEntries(normalized.headers.entries()),
    ...(body === undefined ? {} : { body }),
  }
  const cancel = (): void => { bridge.cancelFetch(id) }
  signal.addEventListener('abort', cancel, { once: true })
  let head
  try {
    head = await bridge.openFetch(request)
  } catch (error) {
    signal.removeEventListener('abort', cancel)
    if (isAborted(signal)) throw abortError(signal)
    throw error
  }
  if (isAborted(signal)) {
    cancel()
    signal.removeEventListener('abort', cancel)
    throw abortError(signal)
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await bridge.readFetch(id)
        if (next.done) {
          signal.removeEventListener('abort', cancel)
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array(next.value))
      } catch (error) {
        signal.removeEventListener('abort', cancel)
        controller.error(error)
      }
    },
    cancel() {
      signal.removeEventListener('abort', cancel)
      cancel()
    },
  })
  return new Response(stream, {
    status: head.status,
    statusText: head.statusText,
    headers: head.headers,
  })
}

/** API Proxy client whose fetch aspect crosses Electron IPC. */
export class ElectronApiClient extends AbstractApiClient {
  /** @param bridge - isolated preload fetch interface. */
  constructor(private readonly bridge: ElectronRendererBridge) {
    super()
  }

  /**
   * Pin Host requests to the internal origin IPC accepts.
   * Privileged `dsh://app` reports a non-null `location.origin` in Chromium.
   * @returns the Host origin accepted by desktop IPC.
   */
  protected override resolveBase(): string {
    return INTERNAL_HOST_ORIGIN
  }

  /**
   * Execute one API request through the preload bridge.
   * @param input - absolute API URL.
   * @param init - fetch options.
   * @returns a standard streaming Response.
   */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return electronFetch(
      this.bridge,
      new URL(`${input.pathname}${input.search}`, INTERNAL_HOST_ORIGIN),
      init,
    )
  }
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
