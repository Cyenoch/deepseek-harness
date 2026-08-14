import { describe, expect, it, vi } from 'vitest'
import type {
  ElectronFetchRead,
  ElectronFetchRequest,
  ElectronRendererBridge,
} from '../src/client/electron-contract.ts'
import { ElectronApiClient, electronFetch, rewriteDesktopFetchUrl } from '../src/client/electron-api-client.ts'

function bridge(overrides: Partial<ElectronRendererBridge> = {}): ElectronRendererBridge {
  return {
    windowChrome: 'default',
    manifest: async () => ({}),
    openFetch: async request => ({
      id: request.id,
      status: 200,
      statusText: 'OK',
      headers: {},
    }),
    readFetch: async () => ({ done: true }),
    cancelFetch: () => {},
    saveSessionExport: async () => {},
    onStatus: () => () => {},
    ...overrides,
  }
}

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

describe('Electron renderer Fetch carrier', () => {
  it('preserves Request metadata and pulls response chunks on demand', async () => {
    let opened: ElectronFetchRequest | undefined
    const reads: ElectronFetchRead[] = [
      { done: false, value: encode('hello') },
      { done: false, value: encode(' desktop') },
      { done: true },
    ]
    const readFetch = vi.fn(async (_id: string): Promise<ElectronFetchRead> => reads.shift() ?? { done: true })
    const response = await electronFetch(bridge({
      openFetch: async (request) => {
        opened = request
        return {
          id: request.id,
          status: 201,
          statusText: 'Created',
          headers: { 'x-carrier': 'electron' },
        }
      },
      readFetch,
    }), new Request('http://dsh.internal/api/session.create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":"desktop"}',
    }))

    expect(opened).toMatchObject({
      url: 'http://dsh.internal/api/session.create',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":"desktop"}',
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-carrier')).toBe('electron')
    expect(await response.text()).toBe('hello desktop')
    expect(readFetch).toHaveBeenCalledTimes(3)
  })

  it('cancels the private request when the caller aborts during open', async () => {
    const controller = new AbortController()
    const cancelFetch = vi.fn()
    const openFetch = vi.fn(async () => {
      controller.abort()
      throw new Error('bridge closed')
    })
    await expect(electronFetch(
      bridge({ openFetch, cancelFetch }),
      'http://dsh.internal/api/session.list',
      { signal: controller.signal },
    )).rejects.toThrow('This operation was aborted')
    expect(cancelFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an already-aborted request before opening IPC', async () => {
    const controller = new AbortController()
    controller.abort()
    const openFetch = vi.fn()
    await expect(electronFetch(
      bridge({ openFetch }),
      'http://dsh.internal/api/session.list',
      { signal: controller.signal },
    )).rejects.toThrow('This operation was aborted')
    expect(openFetch).not.toHaveBeenCalled()
  })
})

describe('desktop fetch origin rewrite', () => {
  it('keeps the internal Host origin and rewrites the privileged document origin', () => {
    expect(rewriteDesktopFetchUrl('/api/session.list', 'dsh://app')?.href)
      .toBe('http://dsh.internal/api/session.list')
    expect(rewriteDesktopFetchUrl('dsh://app/api/dynamicCordisRunner/inventory', 'dsh://app')?.href)
      .toBe('http://dsh.internal/api/dynamicCordisRunner/inventory')
    expect(rewriteDesktopFetchUrl('https://example.com/api', 'dsh://app')).toBeUndefined()
  })

  it('pins ElectronApiClient fetches to the internal Host origin', async () => {
    let opened: string | undefined
    const client = new class extends ElectronApiClient {
      call(url: URL): Promise<Response> {
        return this.doFetch(url)
      }
    }(bridge({
      openFetch: async (request) => {
        opened = request.url
        return { id: request.id, status: 200, statusText: 'OK', headers: {} }
      },
    }))
    const response = await client.call(new URL('dsh://app/api/events.mux'))
    expect(opened).toBe('http://dsh.internal/api/events.mux')
    expect(response.status).toBe(200)
  })
})
