/**
 * The session-log app's side panel surfaces: the launchpad card and the tab
 * body (download button + shared result modal). Presentation only; the
 * download controller and its `/export` command wiring live in index.ts.
 */
import type { ReactNode } from 'react'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SessionLogDownloadDialog,
  type SessionLogDownloadDialogProps,
} from './Dialog.tsx'
import css from './SidepanelApp.module.css'

/** The app's seat key on both side panel slots. */
const APP_ID = 'session-log'

/** Full launchpad entry props: standard kit + the owner `open` action. */
export type SessionLogLaunchCardProps =
  & PropsRuntime<'sidepanel.launchpad'>
  & PropsLocale<'session-log-download'>

/** One bookmark card for the session-log app. */
export function SessionLogLaunchCard({ open, t }: SessionLogLaunchCardProps): ReactNode {
  return (
    <button
      type="button"
      className={css.card}
      onClick={() => { open({ id: APP_ID, title: t('app.title') }) }}
    >
      <span className={css.cardIcon} aria-hidden><IconDownloadOutline16 size={16} /></span>
      <span className={css.cardText}>
        <span className={css.cardTitle}>{t('app.title')}</span>
        <span className={css.cardDescription}>{t('app.description')}</span>
      </span>
    </button>
  )
}

/** Full app body props: standard session-maybe kit + inject + locale. */
export type SessionLogSidepanelAppProps = SessionLogDownloadDialogProps

/** The tab body: notice without a session, download button + modal with one. */
export function SessionLogSidepanelApp(props: SessionLogSidepanelAppProps): ReactNode {
  const { sessionId, useSessionLogDownload, request } = props
  // The bound controller hook stays called in both states (the guard below
  // must not vary the hook count across the session/no-session boundary).
  const entry = useSessionLogDownload(state =>
    sessionId === undefined ? undefined : state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'

  if (sessionId === undefined) {
    return <div className={css.empty}>{props.t('app.noSession')}</div>}
  return (
    <div className={css.body}>
      <button
        type="button"
        className={css.downloadButton}
        disabled={busy}
        aria-busy={busy}
        onClick={() => { void request(sessionId) }}
      >
        <span>{props.t('app.button')}</span>
        <IconDownloadOutline16 size={12} />
      </button>
      <SessionLogDownloadDialog {...props} />
    </div>
  )
}
