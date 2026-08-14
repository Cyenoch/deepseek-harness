# Client Modules

English | [中文](client-modules.zh.md)

The Host client plugin table in [dsh-client-modules](../../packages/client/modules), provided as `ctx.clientModules` (`ClientModuleRegistry`). It scans Host Loader entries for packages declaring `dsh.client` and always composes the `window.__DSH_BOOT__` entry graph. With `ctx.webServer`, it serves `/plugins/<id>/client.js` and injects the manifest through an index tap. The desktop profile disables that HTTP carrier; Electron reads `graph()` and `clientPath(id)`, serves bundles through `dsh://bundle`, and seeds the manifest through preload. This optional GUI capability is not part of the agent-loop spine. The same package's browser half (`ctx.modules`, the lazy CJS module table that fetches and materializes those bundles) is kernel machinery documented in the [package README](../../packages/client/modules/README.md).

Source: [`packages/client/modules/src/client/manifest.ts`](../../packages/client/modules/src/client/manifest.ts)

## The wire

The graph is the wire single source between the Node and browser halves: the host composes `WebBootEntry` rows from scanned packages, injects the graph as the first script in `<head>` (`window.__DSH_BOOT__`, with `<` escaped so plugin-controlled strings cannot break out of the script element), and the shell parses it before booting anything. A page without a valid manifest cannot boot — the browser-side parser throws loud on a missing or malformed graph.

```ts type-equiv
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
}
```

```ts type-equiv
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /** Composed entries; order carries no semantics (activation order is fiber inject waiting). */
  entries: WebBootEntry[]
}
```

Each row's `rev` is the bundle's content hash and rides the URL as a cache-busting query; the graph `rev` hashes the composed rows, so any row change changes it. `immediately` marks the stage-one prefetch tier (fetch and execute during module-face boot, registration only); a lazy row is fetched on first import.

## The scan

A package joins the table by declaring `dsh.client` (`platform: 'web'`, optional `inject` edges, optional `immediately`) in its package.json and exporting its built bundle at `exports["./client"]`. Package resolution anchors at the config tree's `ctx.baseUrl` — the cordis.yml directory, whose package declares every composed plugin as a dependency — and construction throws when that anchor is unset.

Scanning is incremental per package; there is no full-rescan code path. Every cordis `internal/plugin` emission (fiber construction or disposal) marks the fiber's entry name dirty, and a microtask flush reconciles each dirty name against the live loader entries. The activation pass seeds the same dirty set with all current entries and flushes synchronously, so first scan and steady state share one implementation — with opposite failure postures. At activation, a malformed declaration or missing bundle among the already-loaded entries aggregates into one loud `AggregateError` listing every broken package: the fiber FAILS and the boot's fail-loud sweep reports it. In steady state, a broken package logs a warning and must not poison the others.

Package metadata — including the negative "not a client package" verdict — is cached per name and never expires: plugin-set changes take effect on restart. A fiber restart reuses its row and rev untouched; bundle content changes reach the graph only through `rebuilt()`.

## Carrier publication

The Web carrier serves `GET`/`HEAD /plugins/<id>/client.js` from disk with `no-cache` and injects the current graph into every index render; other methods are 405, and unknown or unreadable bundle ids return 404 rather than falling through to SPA HTML. The Electron carrier leaves `webServer` absent, obtains the same graph and authorized absolute bundle paths directly from the registry, and publishes them through its main-process `dsh://bundle` handler. Graph composition therefore survives when either publication mechanism is disabled.

## The service

`ClientModuleRegistry` (`ctx.clientModules`, defined in [`packages/client/modules/src/index.ts`](../../packages/client/modules/src/index.ts)) exposes reads and the rebuild face; signatures are in the generated [service catalog](#ctxclientmodules--clientmoduleregistry). `graph()` returns the current composed graph (a stable object between changes) and `clientPath(id)` the bundle's absolute path. `rebuilt(id)` is the only entry point through which bundle content reaches the graph: it re-hashes the file, and only a real rev change recomposes the graph and notifies. `onRebuilt` fires per changed bundle with the new rev; `onGraphChanged` fires after any flush that recomposed the graph (row added or removed, or a rebuilt rev change) and is pull-model — listeners re-read `graph()`. Both notification paths contain listener exceptions so one throwing subscriber cannot skip later subscribers or kill whatever triggered the flush.

In development, [dsh-client-hmr](../../packages/client/hmr/README.md) is the registry's watch driver: its node half stat-polls every graph row's bundle from a synchronously captured baseline, calls `rebuilt(id)` on change, resyncs its watch set through `onGraphChanged`, and broadcasts rev changes to the browser half over SSE. Production graphs omit the HMR row entirely; the module host itself never watches files.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxclientmodules--clientmoduleregistry"></a>

### `ctx.clientModules` — `ClientModuleRegistry`

The client plugin table: incremental `dsh.client` scan, carrier-independent graph composition, optional Web publication, and the HMR node half's registration and notification service. Construction runs the activation scan synchronously, so malformed declarations and missing bundles among already-loaded entries fail the owning fiber before a carrier reads the graph.

```ts cordis-catalog
/**
 * Current composed entry graph (stable object between changes).
 * @returns the graph served as `window.__DSH_BOOT__`.
 */
graph(): WebBootGraph

/**
 * Absolute path of an entry's client bundle.
 * @param id - entry id (package name).
 * @returns the path, or undefined for an unknown id.
 */
clientPath(id: string): string | undefined

/**
 * Re-hash one bundle (the HMR watch's registration hook — the only entry
 * point through which bundle content changes reach the graph).
 * @param id - entry id (package name).
 * @returns the new rev, or undefined for an unknown id.
 */
rebuilt(id: string): string | undefined

/**
 * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
 * @param listener - receives the entry id and its new bundle rev.
 * @returns the unsubscriber.
 */
onRebuilt(listener: (id: string, rev: string) => void): () => void

/**
 * Fires after any flush that recomposed the graph (row added/removed, or a
 * rebuilt rev change). Pull model: listeners re-read {@link graph}.
 * @param listener - notified with no payload.
 * @returns the unsubscriber.
 */
onGraphChanged(listener: () => void): () => void
```

Source: [`packages/client/modules/src/index.ts:185`](../../packages/client/modules/src/index.ts)

<a id="ctxdesktopruntime--desktopruntime"></a>

### `ctx.desktopRuntime` — `DesktopRuntime`

Runtime values that release Electron-only rows after this bundle mounts.

Source: [`packages/bundle/desktop-app/src/index.ts:14`](../../packages/bundle/desktop-app/src/index.ts)
<!-- END GENERATED cordis-surface -->
