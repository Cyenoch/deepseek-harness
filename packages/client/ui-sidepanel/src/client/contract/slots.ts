/**
 * Side panel slot contracts: the app seats the shell declares inside the
 * layout-owned 'sidepanel' column, plus the props faces its occupants and
 * contributors compose against.
 */
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStoreFor,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  TerminalAttachRequest,
  TerminalAttachResult,
  TerminalResizeResult,
  TerminalSessionIdValue,
  TerminalStreamReadResult,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidepanel' entry) into
// every program that sees this contract, so PropsRuntime<'sidepanel'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidePanelTab } from '../stores.ts'

export type { SidePanelTab } from '../stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One open side panel app, dispatched by its registration key ('btw',
     * 'terminal', …). Declared by ui-sidepanel's shell entry (declaring is
     * claiming): registering with a fresh key adds an app without touching
     * the shell. Session-maybe so an app owns its no-session state itself.
     */
    'sidepanel.app': { kind: 'keyed'; scope: 'session-maybe'; owner: SidepanelAppOwnerProps }
    /**
     * Launchpad entries: the bookmark cards a user picks to open a tab.
     * Each entry knows its own identity and calls the owner `open` with the
     * tab to open. Declared by ui-sidepanel's shell entry.
     */
    'sidepanel.launchpad': { kind: 'list'; scope: 'session-maybe'; owner: SidepanelLaunchpadOwnerProps }
  }
}

/** App owner share: empty — the keyed dispatch site passes nothing per app. */
export interface SidepanelAppOwnerProps {}

/** Launchpad owner share: the shell's tab-opening action. */
export interface SidepanelLaunchpadOwnerProps {
  /** Open (and activate) one tab; re-opening an open tab only activates it. */
  open: (tab: SidePanelTab) => void
}

/** Injected face of the shell entry: panel-level actions from ctx.layout. */
export interface SidePanelRootInjected {
  /** Close the whole side panel column (width to zero; tabs stay open). */
  close: () => void
}

/** Injected face of the header toggle entry. */
export interface SidePanelToggleInjected {
  /** Toggle the side panel column open/closed. */
  toggle: () => void
}

/** Injected face of the /btw app entry. */
export interface BtwAppInjected {
  /**
   * Submit one side question through the host command plane. Resolves after
   * the host durably logged the lifecycle; throws on transport failure.
   */
  ask: (sessionId: SessionId, question: string) => Promise<void>
}

/** Browser-safe terminal operations supplied by the Host Remote assembly. */
export interface TerminalAppInjected {
  /** List PTY backends that expose a raw human-terminal transport. */
  listBackends: (sessionId: SessionId) => Promise<string[]>
  /** Resume or create the stable side-panel PTY. */
  attach: (
    sessionId: SessionId,
    request: TerminalAttachRequest,
    signal: AbortSignal,
  ) => Promise<TerminalAttachResult>
  /** Send keyboard input without newline conversion. */
  write: (sessionId: SessionId, id: TerminalSessionIdValue, data: string) => Promise<void>
  /** Long-read raw VT output after the supplied cursor. */
  read: (
    sessionId: SessionId,
    id: TerminalSessionIdValue,
    cursor: number,
    signal: AbortSignal,
  ) => Promise<TerminalStreamReadResult>
  /** Apply renderer dimensions to the remote PTY. */
  resize: (
    sessionId: SessionId,
    id: TerminalSessionIdValue,
    cols: number,
    rows: number,
  ) => Promise<TerminalResizeResult>
  /** Close and join the remote PTY. */
  closeTerminal: (sessionId: SessionId, id: TerminalSessionIdValue) => Promise<boolean>
}

/** Shell component props: the four shares over the shell's own declarations. */
export type SidePanelRootProps =
  & PropsRuntime<'sidepanel'>
  & PropsRenderSlots<'sidepanel.app' | 'sidepanel.launchpad'>
  & PropsStoreFor<'sidepanel', ReturnType<typeof import('../stores.ts').createSidePanelStore>>
  & InjectFace<SidePanelRootInjected>
  & PropsLocale<'sidepanel'>

/** Header toggle props. */
export type SidePanelToggleProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<SidePanelToggleInjected>
  & PropsLocale<'sidepanel'>

/** One launchpad card's props (locale-owned copy; the owner action opens the tab). */
export type SidePanelLaunchCardProps =
  & PropsRuntime<'sidepanel.launchpad'>
  & PropsLocale<'sidepanel'>

/** The /btw app's props. */
export type BtwAppProps =
  & PropsRuntime<'sidepanel.app'>
  & InjectFace<BtwAppInjected>
  & PropsLocale<'sidepanel'>

/** The libghostty-backed terminal app's props. */
export type TerminalAppProps =
  & PropsRuntime<'sidepanel.app'>
  & InjectFace<TerminalAppInjected>
  & PropsLocale<'sidepanel'>
