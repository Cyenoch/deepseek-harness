/**
 * Wire protocol of the `/plugins/events` dev SSE channel — single source for
 * both halves of this package. Frames still cross a wire boundary: the
 * browser half validates them at its JSON parse point; sharing the type keeps
 * the two ends from drifting, not from parsing.
 */

import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** One SSE frame: the full graph on connect, or one rebuilt bundle notice. */
export type PluginsEventFrame =
  | { type: 'graph'; graph: WebBootGraph }
  | { type: 'rebuilt'; id: string; rev: string }

/** System SSE endpoint pushing graph/rebuilt frames (wire protocol constant). */
export const EVENTS_ENDPOINT = '/plugins/events'

/** Shared bundle-poll interval for the Host watcher and Electron renderer receiver. */
export const DEFAULT_POLL_INTERVAL_MS = 500
