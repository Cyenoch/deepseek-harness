import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls ui-sidepanel's SlotMap merge (the 'sidepanel.app' entry)
// so PropsRuntime<'sidepanel.app'> resolves in this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidepanel/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the side panel contribution. */
export interface SessionLogDownloadDialogInjected {
  hooks: { sessionLogDownload: ObservableSnapshot<SessionLogDownloadState> }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'sidepanel.app'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Modal shared by the side panel button and this browser's `/export` command.
 * @param props - Session runtime (session-maybe), bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps) {
  // The session-maybe seat yields `undefined` while no session is current;
  // no entry exists under that key, so the modal stays closed.
  const key = sessionId === undefined ? '' : String(sessionId)
  const entry = useSessionLogDownload(state => state.bySession[key])

  const status = entry?.status
  const open = entry?.open === true
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')

  return (
    <Modal
      open={open}
      onClose={() => { if (sessionId !== undefined) dismiss(sessionId) }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
      footer={<Button variant="primary" onClick={() => { if (sessionId !== undefined) dismiss(sessionId) }}>{t('dialog.close')}</Button>}
    />
  )
}
