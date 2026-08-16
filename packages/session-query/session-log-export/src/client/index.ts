/** Browser plugin owning Session export download state and its shared modal. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: the 'sidepanel.app' and 'sidepanel.launchpad' SlotMap rows
// (declared by the side panel plugin) must be in the program for the
// register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-sidepanel/client'
import { SessionLogDownloadController } from './controller.ts'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import { SessionLogLaunchCard, SessionLogSidepanelApp } from './SidepanelApp.tsx'
import { en, NS, zh, type SessionLogDownloadKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

export type { SessionLogDownloadEntry, SessionLogDownloadState } from './controller.ts'

export const inject = ['slots', 'locale']

/**
 * Provide the download controller and mount its app into the side panel.
 * @param ctx - browser context carrying slots and locale services.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-log-download: browser dictionaries')
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success') void controller.download(sessionId)
  })
  const injectProps = (): SessionLogDownloadDialogInjected => ({
    hooks: { sessionLogDownload: controller.store },
    request: sessionId => controller.download(sessionId),
    dismiss: (sessionId) => { controller.dismiss(sessionId) },
  })
  ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register({
    name: 'sidepanel.launchpad',
    id: 'session-log',
    locale: NS,
  }, SessionLogLaunchCard))
  ctx.slots.inject('sidepanel.app', () => ctx.slots.register({
    name: 'sidepanel.app',
    key: 'session-log',
    locale: NS,
    inject: injectProps,
  }, SessionLogSidepanelApp))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'
