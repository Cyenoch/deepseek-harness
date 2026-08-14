/**
 * Electron desktop composition marker and model-visible surface context. The
 * application process owns native services and Host lifecycle before this row mounts.
 * @module @deepseek-ai/dsh-desktop-app
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** Runtime values that release Electron-only rows after this bundle mounts. */
export interface DesktopRuntime {
  /** Physical transport owned by the Electron main process. */
  readonly transport: 'electron'
}

const DESKTOP_RUNTIME: DesktopRuntime = { transport: 'electron' }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Electron desktop composition marker. */
    desktopRuntime: DesktopRuntime
  }
}

/**
 * Publish the desktop runtime marker and register the desktop interaction context.
 * @param ctx - Host Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.provide('desktopRuntime', DESKTOP_RUNTIME)
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:desktop-surface',
      order: -98,
      text: 'You are interacting with the user through the DeepSeek Harness Electron desktop application. '
        + 'When the user refers to "this window", "this GUI", or "this app" without naming another target, they mean this application. '
        + 'The renderer provides no implicit DOM, route, screenshot, or native-computer context.',
    })
  })
}
