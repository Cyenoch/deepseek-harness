/**
 * The session header's side panel toggle: rightmost utility entry that flips
 * the layout column open/closed.
 */
import type { SidePanelToggleProps } from './contract/slots.ts'
import css from './SidePanelRoot.module.css'

/** The toggle button. */
export function SidePanelToggle({ toggle, t }: SidePanelToggleProps) {
  return (
    <button type="button" className={css.headerToggle} aria-label={t('panel.launchpad.title')} title={t('panel.launchpad.title')} onClick={toggle}>
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
        <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M9.75 2.75v10.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  )
}
