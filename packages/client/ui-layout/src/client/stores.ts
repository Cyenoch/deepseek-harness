/**
 * The root entry's layout store: panel geometry as plain widths in px
 * (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 *
 * The store persists to localStorage under `dsh.layout`: dragged panel widths
 * and open/closed preferences survive reloads. The narrow-viewport pair is
 * viewport-derived mirrors — `narrow` records AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference;
 * AppFrame's mount-time setNarrow re-syncs both against the live viewport, so
 * persisted stale values self-correct on first paint.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  SIDEPANEL_DEFAULT, SIDEPANEL_MAX, SIDEPANEL_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport mirror pair described in the module doc.
 */
type LayoutState = { sidebar: number; details: number; sidepanel: number; narrow: boolean; narrowExpanded: boolean }

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  setSidepanel: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  toggleSidepanel: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openSidepanel: (draft: LayoutState) => void
  closeSidepanel: (draft: LayoutState) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      sidepanel: 0,
      narrow: false,
      narrowExpanded: false,
    }),
    persist: 'dsh.layout',
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      setSidepanel: (d, px: number) => { d.sidepanel = clampWidth(px, SIDEPANEL_MIN, SIDEPANEL_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      // The side panel toggles at the wide viewport only (AppFrame decides
      // concession, not the toggle): closed reopens at the contract default.
      toggleSidepanel: (d) => { d.sidepanel = d.sidepanel === 0 ? SIDEPANEL_DEFAULT : 0 },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      openSidepanel: (d) => { if (d.sidepanel === 0) d.sidepanel = SIDEPANEL_DEFAULT },
      closeSidepanel: (d) => { d.sidepanel = 0 },
    },
  })
  return handle
}
