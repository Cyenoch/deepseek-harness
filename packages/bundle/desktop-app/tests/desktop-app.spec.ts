import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply } from '../src/index.ts'

describe('desktop-app composition', () => {
  it('publishes the Electron runtime marker', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.desktopRuntime).toEqual({ transport: 'electron' })
  })

  it('describes the desktop surface without claiming renderer visibility', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(row => row.name === 'app:desktop-surface')
    expect(section?.text).toContain('Electron desktop application')
    expect(section?.text).toContain('no implicit DOM, route, screenshot, or native-computer context')
  })
})
