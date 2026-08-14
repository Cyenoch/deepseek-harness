# @deepseek-ai/dsh-client-hmr

English | [中文](README.zh.md)

Hot reload for script-loaded client plugins. The Web and desktop bundles mount the row unconditionally; without a rebuild watcher rewriting client bundles, the poll observes no changes and the chain stays idle. `pnpm dev:desktop` starts that watcher itself, while a separately launched Web application uses `pnpm dev:web`.

The Web browser half subscribes to the system SSE channel (`GET /plugins/events`); the Electron half polls the same changing client-module graph through the preload manifest method. Both carriers submit one changed plugin at a time to the same serialized reload queue. The sequence per change — `invalidate`, `prefetch` (load and register the new bundle while the old fiber still serves), `registry.delete` (before the fiber: a bare fiber dispose trips the vendored Loader's self-dispose branch, which would mark the entry disabled), drain the old fiber, delete `entry.fiber`, remove owned `<style data-plugin>` tags, `entry.refresh()` re-imports and remounts, `fiber.await()` rethrows startup failures loud. Dependents reload through cordis itself: a fiber's activation epoch strings its service providers' uids, so replacing a provider's fiber cascades every dependent with zero client-side graph analysis. The node half detects rebuilds with one interval that stat-polls each graph bundle from a synchronous baseline, immediately re-hashes after adding a row, retains missing rows as dirty, and publishes only real rev changes; any tsdown watch process producing the bundle therefore triggers HMR with no builder→host channel.

## Model Experience

None, as the reload driver is browser-side machinery; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Reload is coarse by design** — a fresh fiber and fresh components; React state inside the reloaded plugin is lost while the data layer (connection/runtime fibers, Session objects) is untouched. react-refresh-grade state preservation conflicts with "re-executing the bundle re-runs the factory" and is deliberately out.
- **No failure rollback** — a reload that fails leaves the entry FAILED and visible in the loader status projection; the previous bundle is not restored automatically.
- **Boot graph rows remain fixed during a reload** — their stale rev queries are cache keys rather than byte-version locks; the Web and Electron bundle carriers both serve the current registered bundle with `no-cache`. A reconnect or renderer boot reads the current graph.
- **Conversation composer restoration remains incomplete** — reloading `ui-conversation` updates its rendered content but can leave the Hero composer absent. This behavior belongs to the shared Web/Electron fiber-swap path; restarting the renderer restores it.
