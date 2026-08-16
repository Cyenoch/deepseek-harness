// @vitest-environment jsdom
/** Side panel integration through the runtime registry and React renderer. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots, SessionMaybeProvideInfo } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-web-react'
import { apply as sidepanelApply, inject as sidepanelInject } from '@deepseek-ai/dsh-client-ui-sidepanel/client'

const info = (sessionId: string | undefined): SessionMaybeProvideInfo => ({ sessionId, hooks: {}, props: {} })

afterEach(cleanup)

describe('sidepanel full-chain render', () => {
  it('keeps the shell mounted when its session-maybe store adopts the first session', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const currentProvideInfo = createSnapshotStore(info(undefined))
    ctx.provide('sessions', {
      list: createSnapshotStore({}),
      currentProvideInfo,
    })
    ctx.provide('workspaces', { list: createSnapshotStore({}) })
    ctx.provide('layout', { closeSidepanel: () => {}, toggleSidepanel: () => {} })
    const commands = { execute: async () => ({ ok: true }) }
    ctx.provide('remote', { commands, terminals: {} })
    ctx.provide('remote.commands', commands)
    ctx.provide('remote.terminals', {})
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    slots.installLocale(locale)

    slots.register({
      name: 'root',
      children: {
        'sidepanel': { kind: 'single', scope: 'session-maybe' },
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      },
    }, ({ renderSlot }: PropsRenderSlots<'sidepanel' | 'conversation.session.header.utilities'>) => (
      <div data-testid="frame">
        {renderSlot('sidepanel', {})}
        {renderSlot('conversation.session.header.utilities', {})}
      </div>
    ))

    // The sidepanel plugin registers through the same path as production.
    await ctx.plugin({ inject: [...sidepanelInject], apply: sidepanelApply }).await()

    expect(slots.entries('sidepanel')).toHaveLength(1)

    // Renderer over the real host face, beginning in the no-session state.
    slots.install(createSlotRenderer())
    const view = render(<>{slots.renderSlot('root', {})}</>)
    expect(view.container.querySelector('[data-slot="sidepanel"]')).toBeTruthy()
    expect(view.container.querySelector('[data-slot-error]')).toBeNull()
    expect(view.getByRole('tablist')).toBeTruthy()

    act(() => { currentProvideInfo.set(info('s-live')) })
    expect(view.container.querySelector('[data-slot-error]')).toBeNull()
    expect(view.getByRole('tablist')).toBeTruthy()
  })
})
