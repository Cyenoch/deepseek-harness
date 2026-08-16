// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogLaunchCard, SessionLogSidepanelApp, type SessionLogLaunchCardProps } from '../src/client/SidepanelApp.tsx'
import type { SessionLogSidepanelAppProps } from '../src/client/SidepanelApp.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-sidepanel' as SessionId

function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

function bench(fetcher: () => Promise<Response> = async () => new Response('zip')) {
  const controller = new SessionLogDownloadController(fetcher, vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const useSessionLogDownload = bindSessionExport(controller)
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogSidepanelAppProps
  const view = render(<SessionLogSidepanelApp {...props} />)
  return { controller, request, view }
}

afterEach(cleanup)

describe('Session export side panel app', () => {
  it('downloads through the shared controller from the tab body', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'Download session log' })
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('disables the button while either entry path downloads this Session', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const b = bench(() => pending)

    const download = b.controller.download(SID)
    const button = b.view.getByRole('button', { name: 'Download session log' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
  })

  it('renders the no-session notice while no session is current', () => {
    const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
    const props = {
      sessionId: undefined,
      useSessionLogDownload: bindSessionExport(controller),
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogSidepanelAppProps
    const view = render(<SessionLogSidepanelApp {...props} />)
    expect(view.getByText(en['app.noSession'])).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Download session log' })).toBeNull()
  })

  it('the launchpad card opens the tab with its localized title', () => {
    const open = vi.fn()
    const props = { open, t: (key: keyof typeof en): string => en[key] } as never as SessionLogLaunchCardProps
    const view = render(<SessionLogLaunchCard {...props} />)
    fireEvent.click(view.container.querySelector('button')!)
    expect(open).toHaveBeenCalledWith({ id: 'session-log', title: 'Session log' })
  })
})
