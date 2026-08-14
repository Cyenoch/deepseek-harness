/** Host Connection carriers for browser HTTP/WebSocket and Electron IPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { HostConnectionService, type HostConnectionTransport } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'
export type { HostConnectionTransport } from './rpc-host.ts'
export {
  ELECTRON_IPC_CHANNELS,
  type ElectronDesktopStatus,
  type ElectronFetchHead,
  type ElectronFetchPortMessage,
  type ElectronFetchRead,
  type ElectronFetchRequest,
  type ElectronRendererBridge,
} from './client/electron-contract.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
export { DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Ordering is supplied by each composition because Web and Electron require different services. */
export const inject: string[] = []

/** Plugin config for the selected physical carrier. */
export interface ConnectionConfig {
  /** Physical transport. Electron exposes the same Fetch contract over validated main-frame IPC. */
  transport?: HostConnectionTransport
  /**
   * Authorities this Web deployment serves beyond loopback. Electron rejects
   * non-internal URLs before this service sees them.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every request. Electron main enforces the same value before dispatch. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  transport: z.union(['web', 'electron'] as const).default('web'),
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * These configuration and native methods stay loopback-only on Web because
 * `trustedHosts` is not authentication. Electron bypasses the fence only
 * after main validates the current main frame's application URL and the
 * internal Host authority.
 */
const PRIVILEGED_METHODS: Record<string, true> = {
  'agentPreset.read': true,
  'agentPreset.copy': true,
  'agentPreset.openDocument': true,
  'agentPreset.remove': true,
  'host.pickDirectory': true,
  'host.openPath': true,
  'settings.describe': true,
  'settings.openDocument': true,
  'settings.update': true,
  'settings.replace': true,
  'settings.mutate': true,
  'credentials.describe': true,
  'credentials.set': true,
  'credentials.unset': true,
  'llm.discoverModels': true,
}

/**
 * Mount the transport-independent Connection registry, then attach either Web
 * routes/downlinks or the socket-free Electron Fetch dispatcher.
 * @param ctx - Host plugin context.
 * @param config - resolved carrier configuration.
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  const transport = config?.transport ?? 'web'
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const webServer = ctx.get('webServer')
  if (transport === 'web' && webServer === undefined) {
    throw new Error('client-connection: Web transport requires ctx.webServer')
  }

  const connection = new HostConnectionService(ctx, trustedHosts, transport)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (transport === 'web'
        && method !== undefined
        && PRIVILEGED_METHODS[method] === true
        && !isTrustedApiRequest(request, [])) {
        return new Response('forbidden', { status: 403 })
      }
      if (transport === 'web'
        && request.method === 'GET'
        && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  })
  connection.setSharedApiHandler(fetchHandler)

  if (transport === 'electron') return
  if (webServer === undefined) throw new Error('client-connection: Web transport lost ctx.webServer')
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: WebUpgradeRoute['handler'],
    ): void => {
      apiCtx.effect(() => webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          return handle(req, socket, head)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
  })
}
