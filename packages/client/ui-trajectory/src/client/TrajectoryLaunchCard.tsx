/**
 * The trajectory's launchpad card: opens the trajectory as a side panel tab.
 * Presentation only — the tab title reuses the view label so the strip and
 * the card agree under every locale.
 */
import { IconThinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './views.module.css'

/** Full launchpad entry props: standard kit + the owner `open` action. */
export type TrajectoryLaunchCardProps =
  & PropsRuntime<'sidepanel.launchpad'>
  & PropsLocale<'trajectory'>

/** One bookmark card for the trajectory app. */
export function TrajectoryLaunchCard({ open, t }: TrajectoryLaunchCardProps) {
  return (
    <button
      type="button"
      className={css.card}
      onClick={() => { open({ id: 'trajectory', title: t('view.trajectory') }) }}
    >
      <span className={css.cardIcon} aria-hidden><IconThinkOutline16 size={16} /></span>
      <span className={css.cardText}>
        <span className={css.cardTitle}>{t('view.trajectory')}</span>
        <span className={css.cardDescription}>{t('sidepanel.description')}</span>
      </span>
    </button>
  )
}
