/**
 * Side panel plugin, browser half: the browser-style tabbed shell for the
 * layout-owned 'sidepanel' column, its two app seats (keyed content +
 * launchpad cards), the session header toggle, and the shipped /btw side
 * chat and libghostty terminal apps. New apps register one launchpad entry
 * plus one keyed 'sidepanel.app' entry — no shell edits.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap merge ('sidepanel') and ctx.layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities') into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { SidePanelRoot } from './SidePanelRoot.tsx'
import { SidePanelToggle } from './SidePanelToggle.tsx'
import { BtwApp, BtwLaunchCard } from './BtwApp.tsx'
import { TerminalApp, TerminalLaunchCard } from './TerminalApp.tsx'
import { createSidePanelStore } from './stores.ts'
import { en, zh, type SidepanelKey } from './locales.ts'

export type {
  BtwAppInjected, SidePanelLaunchCardProps, SidepanelLaunchpadOwnerProps,
  SidePanelRootInjected, SidePanelRootProps, SidePanelToggleInjected,
  SidePanelToggleProps, SidepanelAppOwnerProps, SidePanelTab, TerminalAppInjected,
} from './contract/slots.ts'
export type { SidepanelKey } from './locales.ts'

// The 'sidepanel.app' and 'sidepanel.launchpad' SlotMap declarations live in
// src/client/contract/slots.ts (their one home); this re-export projects the
// type face onto the package root and keeps the module edge in the emitted
// client/index.d.ts, so aggregate programs receive the merge.
export type * from './contract/slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Side panel shell and app copy. */
    sidepanel: SidepanelKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidepanel'

function remoteValue<T>(operation: string, result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
}

/** Services required by the side panel plugin. */
export const inject = ['slots', 'layout', 'remote', 'remote.commands', 'remote.terminals', 'locale']

/**
 * Register the shell, its seats, the header toggle, and the shipped apps.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidepanel: dictionaries')

  // The shell occupies the layout-owned column and declares its two app
  // seats; the tab store persists per session (mounted on the session-maybe
  // shell entry, keyed dsh.sidepanel.<sessionId>).
  ctx.slots.inject('sidepanel', () => ctx.slots.register({
    name: 'sidepanel',
    locale: NS,
    children: {
      'sidepanel.app': { kind: 'keyed', scope: 'session-maybe' },
      'sidepanel.launchpad': { kind: 'list', scope: 'session-maybe' },
    },
    store: createSidePanelStore,
    inject: (): import('./contract/slots.ts').SidePanelRootInjected => ({
      close: () => { ctx.layout.closeSidepanel() },
    }),
  }, SidePanelRoot))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sidepanel-toggle',
    locale: NS,
    inject: (): import('./contract/slots.ts').SidePanelToggleInjected => ({
      toggle: () => { ctx.layout.toggleSidepanel() },
    }),
  }, SidePanelToggle))

  // The /btw side chat: launchpad card + keyed app. Asking submits the slash
  // line through the host command plane; the answer arrives as the durable
  // command lifecycle the transcript derives from.
  ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register({
    name: 'sidepanel.launchpad',
    id: 'btw',
    locale: NS,
  }, BtwLaunchCard))
  ctx.slots.inject('sidepanel.app', () => ctx.slots.register({
    name: 'sidepanel.app',
    key: 'btw',
    locale: NS,
    inject: (): import('./contract/slots.ts').BtwAppInjected => ({
      ask: async (sessionId, question) => {
        remoteValue('command.execute', await ctx.remote.commands.execute(sessionId, `/btw ${question}`))
      },
    }),
  }, BtwApp))

  // Human terminal: Ghostty renders raw VT output while the Host retains PTY
  // ownership, sandbox policy, and Agent-scoped cleanup.
  ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register({
    name: 'sidepanel.launchpad',
    id: 'terminal',
    locale: NS,
  }, TerminalLaunchCard))
  ctx.slots.inject('sidepanel.app', () => ctx.slots.register({
    name: 'sidepanel.app',
    key: 'terminal',
    locale: NS,
    inject: (): import('./contract/slots.ts').TerminalAppInjected => ({
      listBackends: async sessionId => remoteValue(
        'terminals.interactiveBackends',
        await ctx.remote.terminals.interactiveBackends(sessionId),
      ),
      attach: async (sessionId, request, signal) => remoteValue(
        'terminals.attach',
        await ctx.remote.terminals.attach(sessionId, request, signal),
      ),
      write: async (sessionId, id, data) => {
        remoteValue('terminals.writeInput', await ctx.remote.terminals.writeInput(sessionId, id, data))
      },
      read: async (sessionId, id, cursor, signal) => remoteValue(
        'terminals.readStream',
        await ctx.remote.terminals.readStream(sessionId, id, cursor, signal),
      ),
      resize: async (sessionId, id, cols, rows) => remoteValue(
        'terminals.resize',
        await ctx.remote.terminals.resize(sessionId, id, cols, rows),
      ),
      closeTerminal: async (sessionId, id) => remoteValue(
        'terminals.close',
        await ctx.remote.terminals.close(sessionId, id),
      ),
    }),
  }, TerminalApp))
}
