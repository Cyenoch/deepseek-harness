/**
 * Pure concession-chain column solver for the four-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it, then shrinking the side panel, then
 * auto-closing that too (derived zero widths — preferred width preferences
 * are never rewritten, so widening the window restores them). The sidebar
 * never concedes: its rendered width is always the drag preference (or the
 * collapsed rail), and center absorbs any remaining deficit as the last
 * resort. Inputs are the layout store's plain width preferences (0 = closed);
 * a closed sidebar resolves to the fixed SIDEBAR_COLLAPSED control rail while
 * closed details and side panel resolve to zero width. The
 * SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides the
 * effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number; sidepanel: number }

// Contract-frozen geometry: the four-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Side panel drag clamp floor. */
export const SIDEPANEL_MIN = 320
/** Side panel drag clamp ceiling — sized for a terminal or a chat transcript. */
export const SIDEPANEL_MAX = 720
/** Side panel width before any user drag. */
export const SIDEPANEL_DEFAULT = 420

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the four column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @param sidepanel - side panel width preference in px (0 = closed).
 * @returns resolved widths; details/sidepanel 0 means visually closed (never
 * unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number, sidepanel: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  const p0 = sidepanel === 0 ? 0 : clampWidth(sidepanel, SIDEPANEL_MIN, SIDEPANEL_MAX)

  // Step 1: everything fits at preferred widths.
  if (s + d0 + p0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - d0 - p0, details: d0, sidepanel: p0 }
  }

  // Step 2: shrink details toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - p0 - CENTER_MIN)
  if (s + d1 + p0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, details: d1, sidepanel: p0 }
  }

  // Step 3: auto-close details (derived — preferences untouched); the side
  // panel outranks it in the chain because it hosts ongoing work (side chat,
  // terminal) while details is a transient call inspection.
  if (s + p0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - p0, details: 0, sidepanel: p0 }
  }

  // Step 4: shrink the side panel toward its minimum.
  const p1 = p0 === 0 ? 0 : Math.max(SIDEPANEL_MIN, viewport - s - CENTER_MIN)
  if (s + p1 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, details: 0, sidepanel: p1 }
  }

  // Step 5: auto-close the side panel; center absorbs any remaining deficit
  // (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0, sidepanel: 0 }
}
