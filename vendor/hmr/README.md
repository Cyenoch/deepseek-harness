# @cordisjs/plugin-hmr

Hot module replacement for loader-managed Cordis plugins.

The HMR plugin watches source files, traces Node's module graph, clears affected
module caches, and reloads only the plugin entries that depend on changed
application files. Changes to framework-level dependencies fall back to
`loader.exit()`, letting the host process restart.

Module watches canonicalize their existing base directory before opening
Chokidar. Exact config watches likewise canonicalize the deepest existing
ancestor, then restore any missing suffix. Callbacks and diagnostics retain the
requested absolute filename, while the native backend receives one filesystem
spelling even when Windows supplied an 8.3 alias.

## Requirements

- `@cordisjs/plugin-loader`
- `@cordisjs/plugin-timer`
- Node's internal module loader for non-empty module roots. A config-only
  instance (`root: []`) works without it.
- `process.argv[1]` only when classifying a CLI entry as external. Embedders
  without a script path use an empty main-entry externals set.

## Usage

```yaml
- id: timer
  name: '@cordisjs/plugin-timer'
- id: hmr
  name: '@cordisjs/plugin-hmr'
  config:
    root:
      - src
    ignored:
      - '**/node_modules'
      - '**/.*'
    debounce: 100
```

## Config

| Field | Description |
| --- | --- |
| `base` | Optional base directory resolved from `ctx.baseUrl`. |
| `root` | Chokidar roots to watch. Defaults to `['.']`. |
| `ignored` | Picomatch patterns excluded from watch and reload analysis. |
| `debounce` | Milliseconds to wait before processing a burst of changes. |

## Events

| Event | Description |
| --- | --- |
| `hmr/change` | Emitted for changed files that are not handled by plugin reload or config reload. |
| `hmr/reload` | Emitted after one or more plugin entries are reloaded. |
