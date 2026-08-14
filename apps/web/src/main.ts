/**
 * Web application entry: thin bootstrap over the shell library. The Electron
 * preload supplies the Host graph before the same shell boots from `dsh://app`.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { ElectronRendererBridge } from '@deepseek-ai/dsh-client-connection/client'
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'

async function main(): Promise<void> {
  const el = document.getElementById('root')
  if (el === null) throw new Error('web app: missing #root')
  const desktop = (window as Window & { dshDesktop?: ElectronRendererBridge }).dshDesktop
  // AppWebEntry consumes __DSH_BOOT__ while releasing its Loader hold, so the
  // preload manifest must be installed before any client plugin starts.
  if (desktop !== undefined) {
    document.documentElement.dataset.dshWindowChrome = desktop.windowChrome
    ;(globalThis as DshWindow).__DSH_BOOT__ = await desktop.manifest()
  }
  await new AppWebEntry(el).run()
  if (desktop !== undefined) {
    // An explicit document focus survives BrowserWindow hide/show without
    // Chromium selecting the first sidebar button.
    const focusDocument = (): void => {
      document.body.tabIndex = -1
      document.body.focus({ preventScroll: true })
    }
    if (document.activeElement === document.body) focusDocument()
    let keyboardFocus = false
    document.addEventListener('keydown', () => { keyboardFocus = true }, { capture: true })
    document.addEventListener('pointerdown', () => { keyboardFocus = false }, { capture: true })
    const releasePointerFocus = (): void => {
      const active = document.activeElement
      if (active instanceof HTMLButtonElement && !keyboardFocus) focusDocument()
    }
    window.addEventListener('blur', releasePointerFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releasePointerFocus()
    })
  }
}

void main()
