# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The native DeepSeek Harness application. This private workspace packages Electron with the existing Web renderer and runs the `desktop` Cordis profile inside Electron's main process. There is no local HTTP server or child harness process: renderer requests cross a narrow preload bridge, and main dispatches them directly to the Host Connection service.

Reusable embedding, IPC, and packaging constraints are collected in [wrapping DSH with Electron](../../docs/cookbook/wrapping-dsh-with-electron.md).

## Runtime behavior

Electron opens a local supervisor page while `runProfile()` composes the embedded Host. Main supplies the native directory-picker service before composition, reads the settled client-module graph, then serves [`apps/web/dist`](../web/dist) from the privileged `dsh://app` origin. Client bundles use `dsh://bundle`; the module id selects a registered bundle and the revision query is its cache key. During HMR, an existing boot URL deliberately reads the current bytes for that id under `no-cache`.

On macOS, main runs the user's login shell once before Host composition and imports its missing exported variables. Variables supplied directly to Electron retain precedence; PATH keeps its existing lookup order and appends only login-shell directories that are absent. A failed or incomplete probe emits a warning and keeps the inherited environment unchanged. This gives Agent shell commands the same package-manager and version-manager executables as a terminal launch without letting shell startup replace explicit application launch values.

On macOS the main `BrowserWindow` uses `hiddenInset` with traffic lights at `x=12`, `y=12`. The renderer receives the typed `macos-hidden-inset` chrome mode, balances top sidebar spacing around the 14px controls, and exposes a 32px transparent draggable strip above interactive controls. Other platforms keep default chrome.

The renderer has `contextIsolation`, Chromium sandboxing, and Web security enabled, with Node integration disabled. Preload exposes only manifest lookup, Fetch open/read/cancel, Session export save, and supervisor status methods. Fetch IPC accepts only `http://dsh.internal`, validates methods, headers, body size, and the main-frame sender, then streams response chunks through a private `MessagePort` with renderer-driven backpressure. The renderer client pins Host URLs to that origin even when the document origin is `dsh://app`. External navigation, new windows, webviews, and Chromium downloads are denied.

Session export remains the one renderer-requested native file write. Main accepts only `/api/session.export` with the required query fields and a safe `dsh-session-*.zip` name, shows Electron's save dialog, streams the Host response to a mode-0600 file, and removes a partial file after failure. Folder selection uses Electron's directory dialog through the existing Host capability.

Closing the main window hides it while the embedded Host and active tasks continue. A tray or menu-bar left click, its **Show DeepSeek Harness** command, macOS Dock activation, and a second launch all restore and focus the existing window. The tray context menu also exposes **Quit**; only an explicit application quit disposes the profile, with an eight-second grace preventing teardown from blocking exit indefinitely.

## Development

From the repository root:

```sh
pnpm install
pnpm dev:desktop
```

`dev:desktop` builds the Host packages, Web frontend, main entry, and preload once, starts the client-plugin rebuild watcher, then starts Electron with the normal profile and `$DSH_HOME`. Changes to script-loaded client plugin TypeScript, TSX, and CSS rebuild and replace only the affected client fiber; the Electron process, embedded Host, renderer document, active Session objects, and unrelated client fibers remain running. Local React state owned by the replaced plugin is recreated.

Changes to the Web shell, Electron main or preload, profile composition, or Host-only code still require restarting `pnpm dev:desktop`. Set the same provider environment variables used by `dsh` when exercising model calls.

Build unsigned native artifacts on the target operating system:

```sh
pnpm --dir apps/desktop run build
```

From the repository root, `pnpm run package:desktop` creates current-platform installers and `pnpm run package:desktop:dir` creates an unpacked application for local inspection. `electron-builder` writes artifacts to `apps/desktop/release/`: DMG and ZIP on macOS, AppImage and DEB on Linux, and NSIS EXE and MSI on Windows. The desktop workflow builds the supported macOS arm64 and Windows x64 targets on the standard GitHub-hosted `macos-14` and `windows-2025` runners, verifies each artifact pair, and uploads it as a temporary workflow artifact. After a relevant push to `master`, it publishes both pairs plus `SHA256SUMS` as an unsigned GitHub Release. The tag is `desktop-v<version>-g<full commit SHA>` and the title is `DeepSeek Harness Desktop v<version> (<first 12 commit characters>)`.

Bundles include the repository license, generated [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md), the Web distribution, and the desktop package's production `dependencies`. That list is the closed Host peer graph: `electron-builder` follows `dependencies` only, so every workspace package `runProfile` loads — including Service Definition peers — is declared there. CI runs `verify-runtime-closure` against this manifest before packaging. Native Node addons and executables are unpacked from ASAR where their loaders require filesystem paths. The packaged `node-pty` uses its shipped macOS arm64 and Windows x64 prebuilds instead of an Electron rebuild; its `build/` directory is excluded so a host or stale Electron binary cannot shadow the target prebuild. The packaged main process points `DSH_RIPGREP_PATH` and, on Linux, `DSH_LANDLOCK_RUN_PATH` at their platform binaries in `app.asar.unpacked` unless the launching environment already supplied those deployment overrides, because `child_process.spawn()` cannot execute the virtual `app.asar` paths returned by package resolution. Each supported CI leg runs the packaged Electron executable in Node mode, boots the real desktop profile and Standard Agent, checks the exact tool catalog, and executes the keyless local tool families plus packaged shell, workflow, and code-worker paths before uploading artifacts; the Windows leg also opens and abort-closes the packaged native directory-picker worker.

Before `runProfile`, main recovers the macOS login-shell environment, then prepends `<application path>/node_modules` to `NODE_PATH` and rebuilds Node's extra module paths. Loader `createRequire` stays anchored at the profile directory, so a profile-local package still wins, then the parent walk, then the application graph. Packaged `app.asar` is visible only through paths that already enter the archive; the profile fallback's asar-inbound symlinks therefore do not resolve.

## Known limitations

- **Unsigned artifacts** — code signing and notarization are intentionally absent, so platform trust warnings are expected.
- **No updater** — GitHub Releases distribute installers, but the application neither discovers nor applies updates.
- **External navigation is denied** — the application does not infer a trustworthy user gesture from renderer navigation and therefore does not open external links automatically.
