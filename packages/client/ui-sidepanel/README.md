# @deepseek-ai/dsh-client-ui-sidepanel

English | [中文](README.zh.md)

Side panel plugin: the VS Code-style tabbed right column for [ui-layout](../ui-layout/README.md)'s `sidepanel` slot. Its flat editor tabs hold open apps (click activates, middle-click or × closes), drag between tab strips to reorder or merge, and drop on a pane edge to split left, right, top, or bottom. During a tab drag, the hovered pane shows all five docking targets plus the resulting half-pane or full-pane placement; the nearest edge wins, so corner drops do not make top and bottom inaccessible. The + button and empty groups open a launchpad of bookmark cards, and the session header gains a rightmost toggle. The shipped apps are the `/btw` side chat ([dsh-command-btw](../../interaction/command-btw/README.md) transcript + ask input) and a libghostty-backed interactive terminal; Trajectory and Session log also contribute their own entries. A new app registers one `sidepanel.launchpad` entry plus one keyed `sidepanel.app` entry with no shell edits.

## Mechanics

The shell occupies the layout-owned `sidepanel` column (session-maybe, like the conversation: its blank incarnation adopts the first session without remounting) and declares two seats inside it: `sidepanel.app` (keyed by app id) for tab bodies and `sidepanel.launchpad` (list) for the bookmark cards. The persisted workbench store (`dsh.sidepanel.workbench.<sessionId>`) keeps a recursive tree of tab groups and horizontal or vertical splits per session. Center drops merge or reorder tabs; edge drops create a split; closing the last tab in a non-root group collapses that empty branch. Pointer-dragged dividers preserve a 10% minimum for each adjacent group, and focused dividers accept the matching arrow keys. Arrow keys, Home, and End move through each tab strip. App bodies receive the complete group content rectangle without shell padding or card chrome; each app owns any inset its content needs.

Every open app is mounted once in a stable root layer and positioned over its active group. Inactive apps remain mounted, and moving a tab between groups does not replace its component, so terminal connections and app view state survive both tab switches and splits. The launchpad card supplies the tab title at open time (a language switch does not rename already-open tabs).

The `/btw` app derives its transcript from the conversation nodes snapshot — one row per `command`-kind node named `btw` (question from the logged `command/run` args, answer from the `command/done` outcome, pending while the pairing is open) — and its input submits `/btw <question>` through the host `command.execute` RPC; the durable lifecycle both sides render from is the session log. The host command is whatever `/btw` implementation is composed (the base bundle's [dsh-command-btw](../../interaction/command-btw/README.md)); this package never talks to a model or a subagent directly.

The terminal is an undecorated `ghostty-web` canvas: it has no connected/backend toolbar, border, or inner card padding. `ghostty-web` makes the canvas host editable for input, so the shell suppresses that element's native browser caret while libghostty-vt paints the terminal cursor. The WASM core loads only after the tab has visible, non-zero geometry. The app lists the current Agent's interactive `ctx.terminals` backends through the generated Remote namespace, resumes or creates the stable owner-local `sidepanel-terminal` PTY, forwards raw keyboard input and VT output, and synchronizes renderer dimensions. It supplies the standards-compliant primary device attributes reply that the pinned renderer omits, unless the renderer already answered, so login shells do not wait for terminal capability detection. A human attachment starts the operating-system account's default login shell and preserves its prompt and profile; model terminal sessions retain the backend's controlled Bash defaults. The Host retains sandbox policy, PTY ownership, bounded output, and teardown; closing the tab or changing session closes and joins the attached PTY.

Outer panel geometry (column width, drag, and concession) belongs to [ui-layout](../ui-layout/README.md); this package owns only its internal split tree and triggers `ctx.layout.toggleSidepanel()`/`closeSidepanel()`.

## Composition

Mounted by the web-app bundle beside ui-layout and ui-conversation (the `sidepanel` slot and the `conversation.session.header.utilities` seat must be declared). A new app is two registrations:

```ts ignore-check
ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register(
  { name: 'sidepanel.launchpad', id: 'my-app', locale: NS }, MyLaunchCard))
ctx.slots.inject('sidepanel.app', () => ctx.slots.register(
  { name: 'sidepanel.app', key: 'my-app', locale: NS }, MyApp))
```

The card calls the owner `open({ id, title })`; the keyed entry renders the tab body.

## Model Experience

None, as the side panel renders browser viewing state and command output that [`dsh-commands`](../../interaction/commands/README.md) already logs; asking through the input has the same token effect as typing the `/btw` line yourself.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Terminal sessions are process-local** — the tab can resume its named PTY while the Host process remains live, but a harness restart creates a new shell.
- **Windows has no shipped interactive backend** — the Web bundle disables `terminal-bash` on Windows until its PTY process-tree provider has equivalent support; the launch card reports that no backend is available.
- **Tab titles are frozen at open time** — a language switch renames the launchpad but not already-open tabs; renaming on locale change would need title-by-id derivation.
- **The /btw transcript reads the conversation window** — exchanges older than the loaded window are absent until the window pages up.
