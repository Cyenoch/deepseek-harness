# Agent Note: Electron embeds the desktop Host

Status: implemented

English | [中文](2026-08-14-electron-embedded-desktop-host.zh.md)

## Problem

The desktop application needs the shared Web client, native dialogs, single-instance behavior, and distributable macOS, Windows, and Linux artifacts. Running the Host as a packaged child adds a second runtime closure, process-tree supervision, readiness signaling, loopback socket policy, and platform-specific launchers even though Electron already provides a Node-capable main process.

The renderer remains untrusted Web content. It must not receive Node.js, raw Electron IPC, arbitrary filesystem reads, or a generic network escape merely because the Host lives in the same application.

## Decision

[`apps/desktop`](../../../../apps/desktop/README.md) is the Electron application and the only desktop executable. Its main process calls `runProfile({ profile: 'desktop' })`, so the Cordis Host, profile composition, session lifecycle, and native application lifecycle share one process. The desktop bundle keeps the shared Host and client plugin graph, disables the Web server and browser-only startup rows, and selects the Connection service's `electron` transport.

The sandboxed renderer loads the built Web frontend from `dsh://app`. The main process publishes that document, its static assets, and client plugin bundles through the private `dsh:` protocol. A `dsh://bundle` request must name a registered package id and carry a revision query as its cache key; it serves the current bytes for that id with `no-cache`, so a boot URL remains usable after a development rebuild. Host API calls do not use that protocol: the preload exposes a typed `ElectronRendererBridge`, and each Fetch request receives one private `MessagePort` whose response body advances only when the renderer requests the next chunk. Cancellation propagates to the Host request. The Electron API client always addresses `http://dsh.internal`. Relative fetches and same-document URLs on `dsh://app` are rewritten onto that origin by protocol and hostname before they cross the preload bridge, because a privileged custom scheme reports a non-null `location.origin` in Chromium while the URL spec reports `'null'`.

The desktop profile keeps client-plugin HMR active with the `electron` notification carrier. Its Host half stat-polls registered bundle paths and advances the shared graph revision after a content change. Its renderer half polls that graph through the existing preload manifest method, then uses the same serialized fiber replacement path as Web SSE HMR. `pnpm dev:desktop` starts the client bundle watcher and Electron together. Script-loaded client plugin changes therefore preserve the Electron process, embedded Host, renderer document, active Session objects, and unrelated client fibers; Web shell, main, preload, composition, and Host-only changes still require restarting the command.

Every IPC handler accepts only the current main frame at the supervisor page or `dsh://app/index.html`. Fetch inputs, export URLs, and filenames are parsed before use. `contextIsolation`, renderer sandboxing, disabled Node integration, denied window creation, denied webviews, blocked downloads, and an allowlisted navigation policy keep Electron authority in main and preload.

Electron does not expose Node's internal ESM loader. The vendored Loader's standard-runtime fallback resolves non-relative plugin names from the configuration tree's `ctx.baseUrl` with public `createRequire` resolution, then loads the result through dynamic import. This preserves the same package-ownership rule for any embedder without an Electron-specific alias table. The desktop `package.json` declares the Host peer closure so the asar contains every workspace package `runProfile` loads; `electron-builder` does not follow `peerDependencies`, and `verify-runtime-closure` gates that list. After `app.ready`, main prepends `join(app.getAppPath(), 'node_modules')` to `NODE_PATH` and calls `Module._initPaths()`. Electron's asar overlay is visible only through paths that already enter the archive, so `$DSH_HOME/profiles/node_modules` inbound symlinks exist on disk but do not resolve; extra paths are searched after the parent walk, and Loader `baseUrl` remains the profile directory. The profile patch watcher mounts HMR with `root: []`; that explicit config-only mode uses only filesystem watching, while non-empty module roots still require Node's internal loader and fail loud.

The ASAR policy leaves platform executables under `app.asar.unpacked`. Both `@vscode/ripgrep` and the Linux Landlock entry package still resolve their platform packages through virtual `app.asar` module paths, which `child_process.spawn()` cannot execute. Before profile boot, packaged main sets `DSH_RIPGREP_PATH` and, on Linux, `DSH_LANDLOCK_RUN_PATH` to the matching physical `app.asar.unpacked` executables unless the launching environment already supplied an override. Each package validates its override before use; CLI and development Electron continue to use ordinary package resolution.

JavaScript, configuration, and Markdown assets remain inside ASAR and are read through Electron's Node-compatible filesystem implementation. That implementation returns ordinary numeric `Stats` even when a caller requests Node's bigint stat overload. `dsh-fs-local` therefore discriminates the returned field types: native filesystem metadata keeps nanosecond version tokens, while numeric virtual metadata uses millisecond timestamps and numeric mode masking. Preset-local skill providers can consequently traverse and read their installed ASAR directories through the same `ctx.fs` path as physical roots.

macOS Finder and Dock launches carry a minimal GUI-session environment rather than the user's login-shell exports. Before profile boot, desktop main runs the configured absolute login shell once with login and interactive startup, reads only its exported environment through a marker-delimited NUL stream, and fills variables missing from Electron's inherited environment. PATH is the one additive value: inherited entries remain first and missing login-shell entries follow, so a terminal's explicit resolution order wins while GUI launches can find Homebrew, pnpm, and version-manager tools. Volatile shell bookkeeping is ignored. A five-second timeout, bounded output, incomplete-marker rejection, and warning-only fallback keep profile code from blocking application startup indefinitely; the inherited environment remains usable if shell startup fails.

Electron owns the native directory-picker backend and session-export save dialog. The desktop profile mounts the native picker client surface explicitly, keeping the Hero and sidebar Workspace entries connected after disabling the Web profile's adaptive picker row. On Windows, the picker runs its blocking COM call in a JavaScript child whose entry remains readable inside ASAR; only that invocation of the current Electron executable receives `ELECTRON_RUN_AS_NODE=1`, matching the packaged ACL runner without changing main's runtime mode. Exports stream directly from the embedded Host to a mode-`0600` file and remove a partial file after failure. One application instance owns the profile. Closing its main window hides it while the embedded Host and active tasks continue; the tray or menu-bar icon, macOS Dock activation, and a second launch restore the same window. Only an explicit application quit begins bounded Host shutdown, with an eight-second grace before process exit.

On macOS the main `BrowserWindow` uses `hiddenInset` with traffic lights at `x=12`, `y=12`. The preload `ElectronRendererBridge` reports the typed `macos-hidden-inset` chrome mode; the renderer balances top sidebar spacing around the 14px controls and exposes a 32px transparent draggable strip above interactive controls. Other platforms keep default chrome.

`electron-builder` packages unsigned macOS DMG/ZIP, Windows NSIS/MSI, and Linux AppImage/DEB artifacts from the desktop package's closed dependency graph. No Tauri, Rust desktop crate, backend sidecar, desktop SEA, readiness socket, or separately packaged Windows ACL runner remains. On Windows, the normal ACL runner script is spawned through the Electron executable with `ELECTRON_RUN_AS_NODE=1` carried only in that child invocation's `ConfinedArgv.environment`.

## Alternatives considered

**Tauri shell plus a packaged Host child.** Rejected because it duplicates the JavaScript runtime closure and requires supervision, readiness, loopback security, separate native products, and Rust application code for capabilities Electron already owns.

**Electron main plus an HTTP Host child.** Rejected because changing only the window toolkit preserves the redundant process, socket, and lifecycle failure modes.

**Expose `ipcRenderer` or Node integration to the page.** Rejected because any renderer compromise would gain a general native capability instead of the three application operations it needs.

**Carry Host API requests over `dsh://`.** Rejected because a custom protocol is appropriate for immutable application-owned bundle reads, while request/response streaming, backpressure, and cancellation need a typed private channel.

**Point Loader `baseUrl` at the asar.** Rejected because the profile directory owns config-relative resolution and user plugins; flattening `baseUrl` onto the installation would skip the profile `node_modules` walk.

**Unpack the entire `node_modules` from the asar.** Rejected because it duplicates the JavaScript graph on disk. `NODE_PATH` reaches the archive without unpacking those packages.

**Teach the filesystem-search package to infer Electron's unpacked path.** Rejected because ASAR layout belongs to the desktop deployment, while `@deepseek-ai/dsh-tool-fs-search` also runs under CLI, remote, and non-Electron embedders. Its existing validated deployment override carries the physical executable path without adding Electron layout knowledge to the package.

**Unpack or special-case the Cordis preset skill directory.** Rejected because the failure applies to every `ctx.fs` metadata probe over an ASAR path, not to skill discovery alone. Normalizing the metadata returned by the backing filesystem preserves one read path for installed and physical assets.

**Add fixed package-manager directories to PATH.** Rejected because Homebrew prefixes differ by architecture and users may rely on nvm, pyenv, mise, or other shell-managed locations. The login shell is the user's existing source for those exports.

**Replace Electron's environment with the login-shell environment.** Rejected because a terminal, CI launcher, or explicit desktop wrapper may intentionally supply values and PATH precedence for this application. Login-shell values only fill gaps, except that missing PATH directories are appended.

**Copy installation packages into `$DSH_HOME`.** Rejected because it forks the installation graph and goes stale.

## Consequences

The desktop artifact is larger than a system-WebView shell because it ships Chromium and Electron. Packaging now follows one JavaScript dependency graph and one application lifecycle, while the renderer stays carrier-independent and the browser profile continues to own HTTP/WebSocket access. On macOS, application startup also executes the user's normal login and interactive shell startup files once; direct launch variables retain precedence, and a failed probe does not prevent the Host from starting.

The [desktop release workflow](../process/2026-08-14-unsigned-desktop-github-releases.md) publishes unsigned Windows x64 and macOS arm64 installers. The application has no updater; signing, notarization, and automatic update policy remain separate distribution decisions rather than implicit runtime behavior.

## Testing

Source Playwright `_electron` e2e (`apps/web/tests/desktop-profile.e2e.ts`) pins the renderer carrier and Standard mode, starts macOS Electron with a minimal GUI PATH plus a temporary login-shell export, verifies main recovers that export and directory, then proves a native-window close hides the window without ending the process before explicit quit completes cleanly. Desktop unit tests pin protocol, IPC validation, login-shell output parsing and merge precedence, application-graph `NODE_PATH` resolution, packaged executable path selection, Electron child Node mode, and manifest revision polling. CI verifies the desktop manifest's runtime closure before `electron-builder`; its packaged-runtime smoke boots the real desktop profile with a fresh `$DSH_HOME`, creates Standard and Cordis Agents, checks the exact platform tool catalog, executes the keyless filesystem, search, shell, job, workspace-skill, todo, collaboration, workflow, and code-runtime paths, and loads both authoring skills from the Cordis preset inside ASAR. The same smoke loads the packaged `node-pty` prebuild and directly executes the unpacked ripgrep binary; its shell call crosses the production sandbox implementation, including the packaged Windows ACL runner. The Windows leg also opens and abort-closes the packaged native directory-picker worker, proving the second Electron Node-mode child entry. An unpacked macOS arm64 `electron-builder --dir` artifact boots the embedded Host against a fresh `$DSH_HOME`: the main window is 1280×800 and shows Choose workspace and Standard mode. A live development probe changed and restored the `ui-conversation` Hero headline while the Electron/Host PID remained stable; it also reproduced the shared HMR path's known incomplete Hero composer restoration.
