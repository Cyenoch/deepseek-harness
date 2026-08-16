# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The Electron desktop composition layer. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-web-app`](../web-app/README.md), disables the HTTP server, Web startup, and adaptive directory-picker row, selects the Connection service's `electron` transport, selects the client HMR service's `electron` manifest transport, and mounts the native directory-picker client surface beside this package's `desktop-app` plugin.

The Electron main process supplies `ctx.desktopRuntime` ordering and the native directory-picker implementation before profile composition. The desktop patch replaces the Web bundle's `webServer` activation dependency on the client-module registry and HMR rows with `desktopRuntime`; the disabled HTTP server therefore cannot leave either row pending. The paired client surface keeps both Workspace picker entry points connected to the native implementation. The Connection Host exposes its Fetch dispatcher without opening a socket, while the client-module registry retains the shared graph and built bundle paths without registering `/plugins` routes. The HMR node half watches those paths and advances graph revisions; the Electron client half reads them through preload and swaps the changed client fiber. Native lifecycle and IPC authority stay in [`apps/desktop`](../../../apps/desktop/README.md), not in this bundle.

## Model Experience

### Desktop-surface context

#### What the model sees

The `app:desktop-surface` global section (order −98) identifies the Electron desktop application as the current user surface and defines “this window”, “this GUI”, and “this app” accordingly. It explicitly states that the model receives no implicit DOM, route, screenshot, or native-computer context.

#### Token effect

One fixed prompt paragraph per model request; this bundle adds no tool schema or tool result.

#### KV Cache effect

The paragraph sits near the system prompt's head and remains identical for the life of the desktop profile, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **Electron-owned service** — booting the desktop profile through the generic CLI does not create a native window or preload bridge; the supported application entry is `apps/desktop`.
- **No network carrier** — disabling the Web server is intentional. Remote browser access requires the separate `web` profile and its trust policy.
