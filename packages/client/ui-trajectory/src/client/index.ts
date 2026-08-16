/**
 * Browser trajectory plugin contributing the trajectory as a side panel app
 * (launchpad card + keyed tab body) without defining a service. The event
 * definitions still register into the conversation view registry; only the
 * presentation seat moved out of the conversation view ring.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'sidepanel.app' and 'sidepanel.launchpad' SlotMap rows
// (declared by the side panel plugin) must be in the program for the
// register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-sidepanel/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import { registerTrajectoryConversationView } from './trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryLaunchCard } from './TrajectoryLaunchCard.tsx'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

/** Required services: the conversation slot, registries, ordinary Session paging, and the locale service. */
export const inject = ['slots', 'conversationEvents', 'conversationViews', 'sessions', 'locale']

/**
 * Client plugin body: register the trajectory side panel app. The
 * registrations ride the slot service's effect wrapper, so plugin unload
 * removes the card and the tab body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  const duration = createTrajectoryDurationStore()
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register({
    name: 'sidepanel.launchpad',
    id: 'trajectory',
    locale: NS,
  }, TrajectoryLaunchCard))
  ctx.slots.inject('sidepanel.app', () => ctx.slots.register({
    name: 'sidepanel.app',
    key: 'trajectory',
    locale: NS,
    // The side panel seat is session-maybe: the inject's first parameter is
    // the current session id, absent in the no-session state the component
    // renders its notice for.
    inject: (sessionId: SessionId | undefined): TrajectoryViewInjected => {
      const session = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId)?.session
      return {
        hooks: { duration },
        loadOlder: async () => {
          if (session === undefined) return false
          const before = session.getSnapshot().views.get('trajectory')
          await session.loadOlder()
          return session.getSnapshot().views.get('trajectory') !== before
        },
        setActualDuration: (value) => { duration.set(value) },
      }
    },
  }, TrajectoryView))
}
