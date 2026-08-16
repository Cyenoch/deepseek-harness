/**
 * One launchpad card: the shared bookmark markup every launchpad entry wraps
 * around its own copy and glyph. The click opens the tab through the owner
 * action; presentation only.
 */
import type { ReactNode } from 'react'
import css from './SidePanelRoot.module.css'

/** Card props: icon node, copy, and the open action. */
export interface LaunchCardProps {
  /** Leading glyph (SVG). */
  icon: ReactNode
  /** Card title (also becomes the tab strip title). */
  title: string
  /** One-line description of what the app does. */
  description: string
  /** Open this card's tab. */
  onOpen: () => void
}

/** The card: a button with glyph, title, and description. */
export function LaunchCard({ icon, title, description, onOpen }: LaunchCardProps) {
  return (
    <button type="button" className={css.card} onClick={onOpen}>
      <span className={css.cardIcon} aria-hidden>{icon}</span>
      <span className={css.cardText}>
        <span className={css.cardTitle}>{title}</span>
        <span className={css.cardDescription}>{description}</span>
      </span>
    </button>
  )
}
