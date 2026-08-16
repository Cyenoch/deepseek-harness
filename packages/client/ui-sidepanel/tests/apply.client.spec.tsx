/** Side panel slot registrations: shell seats, header toggle, shipped apps. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-sidepanel/client'
import type {
  BtwAppInjected, SidePanelRootInjected, SidePanelToggleInjected, TerminalAppInjected,
} from '@deepseek-ai/dsh-client-ui-sidepanel/client'
import { BtwApp, BtwLaunchCard } from '../src/client/BtwApp.tsx'
import { SidePanelRoot } from '../src/client/SidePanelRoot.tsx'
import { SidePanelToggle } from '../src/client/SidePanelToggle.tsx'
import { TerminalApp, TerminalLaunchCard } from '../src/client/TerminalApp.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidepanel: vi.fn(), closeSidepanel: vi.fn() }
  const execute = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  const terminals = {
    interactiveBackends: vi.fn().mockResolvedValue({ ok: true, value: ['shell'] }),
    attach: vi.fn().mockResolvedValue({ ok: true, value: { sessionId: 'pty-1' } }),
    writeInput: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    readStream: vi.fn().mockResolvedValue({ ok: true, value: { data: '', cursor: 0, truncated: false, status: 'exited' } }),
    resize: vi.fn().mockResolvedValue({ ok: true, value: { supported: true } }),
    close: vi.fn().mockResolvedValue({ ok: true, value: true }),
  }
  ctx.provide('layout', layout as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('remote', { commands: { execute }, terminals } as never)
  ctx.provide('remote.commands', { execute } as never)
  ctx.provide('remote.terminals', terminals as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    {
      name: 'root',
      children: {
        'sidepanel': { kind: 'single', scope: 'session-maybe' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
      },
    } as never,
    () => null,
  )
  slots.register(
    { name: 'conversation', children: { 'conversation.session.header.utilities': { kind: 'list', scope: 'session' } } } as never,
    () => null,
  )
  return { ctx, slots, layout, execute, terminals }
}

describe('ui-sidepanel apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'remote', 'remote.commands', 'remote.terminals', 'locale'])
  })

  it('registers the shell with its two app seats and persisted tab store', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidepanel')).toHaveLength(1)
    expect(b.slots.spec('sidepanel.app')).toEqual({ kind: 'keyed', scope: 'session-maybe' })
    expect(b.slots.spec('sidepanel.launchpad')).toEqual({ kind: 'list', scope: 'session-maybe' })
    const shell = b.slots.entries('sidepanel')[0]!
    expect(shell.component).toBe(SidePanelRoot)
    expect(shell.locale).toBe('sidepanel')
    expect(shell.store).toMatchObject({ spec: { persist: 'dsh.sidepanel.workbench' } })
    const injected = shell.inject as unknown as () => SidePanelRootInjected
    injected().close()
    expect(b.layout.closeSidepanel).toHaveBeenCalledOnce()
  })

  it('registers the header toggle and the two shipped apps on both seats', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const toggle = b.slots.entries('conversation.session.header.utilities')
      .find(entry => entry.options.id === 'sidepanel-toggle')
    expect(toggle).toBeDefined()
    expect(toggle!.component).toBe(SidePanelToggle)
    const toggleInjected = toggle!.inject as unknown as () => SidePanelToggleInjected
    toggleInjected().toggle()
    expect(b.layout.toggleSidepanel).toHaveBeenCalledOnce()

    const launchpad = b.slots.entries('sidepanel.launchpad')
    expect(launchpad).toHaveLength(2)
    expect(launchpad).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: BtwLaunchCard, options: { id: 'btw' }, locale: 'sidepanel' }),
      expect.objectContaining({ component: TerminalLaunchCard, options: { id: 'terminal' }, locale: 'sidepanel' }),
    ]))
    const apps = b.slots.entries('sidepanel.app')
    expect(apps).toHaveLength(2)
    expect(apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ component: BtwApp, options: { key: 'btw' }, locale: 'sidepanel' }),
      expect.objectContaining({ component: TerminalApp, options: { key: 'terminal' }, locale: 'sidepanel' }),
    ]))
  })

  it('the btw ask face submits the slash line and rejects on transport failure', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const btw = b.slots.entries('sidepanel.app').find(entry => entry.options.key === 'btw')
    const ask = (btw!.inject as unknown as () => BtwAppInjected)().ask
    await ask('s-1' as never, 'what changed?')
    expect(b.execute).toHaveBeenCalledWith('s-1', '/btw what changed?')

    b.execute.mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', message: 'gone' } })
    await expect(ask('s-1' as never, 'again?')).rejects.toThrow('command.execute failed: UNAVAILABLE: gone')
  })

  it('the terminal face unwraps every generated Remote operation', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const terminal = b.slots.entries('sidepanel.app').find(entry => entry.options.key === 'terminal')
    const face = (terminal!.inject as unknown as () => TerminalAppInjected)()
    const signal = new AbortController().signal

    await expect(face.listBackends('s-1' as never)).resolves.toEqual(['shell'])
    await face.attach('s-1' as never, { backendType: 'shell', name: 'sidepanel', cols: 80, rows: 24 }, signal)
    await face.write('s-1' as never, 'pty-1' as never, 'pwd\r')
    await face.read('s-1' as never, 'pty-1' as never, 0, signal)
    await face.resize('s-1' as never, 'pty-1' as never, 100, 30)
    await face.closeTerminal('s-1' as never, 'pty-1' as never)

    expect(b.terminals.attach).toHaveBeenCalledWith('s-1', expect.objectContaining({ backendType: 'shell' }), signal)
    expect(b.terminals.writeInput).toHaveBeenCalledWith('s-1', 'pty-1', 'pwd\r')
    b.terminals.interactiveBackends.mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', message: 'gone' } })
    await expect(face.listBackends('s-1' as never)).rejects.toThrow('terminals.interactiveBackends failed: UNAVAILABLE: gone')
  })

  it('removes every entry and declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidepanel')).toHaveLength(0)
    expect(b.slots.entries('sidepanel.app')).toHaveLength(0)
    expect(b.slots.entries('sidepanel.launchpad')).toHaveLength(0)
    expect(b.slots.spec('sidepanel.app')).toBeUndefined()
    expect(b.slots.spec('sidepanel.launchpad')).toBeUndefined()
    expect(b.slots.entries('conversation.session.header.utilities')
      .filter(entry => entry.options.id === 'sidepanel-toggle')).toHaveLength(0)
  })
})
