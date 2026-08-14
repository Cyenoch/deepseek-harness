# Agent Note: Packaged Electron HMR starts without a process script path

Status: implemented

English | [中文](2026-08-14-packaged-electron-hmr-script-path.zh.md)

## Problem

A packaged DeepSeek Harness app fails at Host boot with `The "paths[0]" argument must be of type string. Received undefined` while applying `@deepseek-ai/cordis-plugin-hmr`.

The desktop profile disables the shared module-reload HMR row, then `runProfile` mounts a watch-only instance (`root: []`) so the profile and home `cordis.patch.yml` layers stay live. That instance still walked `process.argv[1]` to classify the CLI entry as an external. A packaged Electron process has no script path in `argv[1]`, and `path.resolve(undefined)` throws before the watcher opens.

## Decision

`vendor/hmr/src/index.ts` collects the main-entry externals set only when `process.argv[1]` is a string. A missing or non-string entry leaves `externals` empty and continues; config-only watching and `registerConfig()` are unchanged.

The launcher still mounts the watch-only instance after a composition that leaves no HMR service. Packaged desktop boot uses that path and no longer depends on a CLI script argument. The [exact-config reload contract](2026-07-20-config-hot-reload-resilience.md) and [main-watcher initial-scan suppression](2026-08-03-hmr-initial-scan-boot-deadlock.md) remain unchanged.

The [embedded desktop Host decision](../architecture/2026-08-14-electron-embedded-desktop-host.md) owns the application composition and packaged runtime; this note owns only the missing-entry behavior inside the vendored HMR service.

## Alternatives considered

**Skip the watch-only HMR fallback in packaged Electron.** Rejected because user patch-layer reload is still the intended long-lived-surface contract; the crash is a missing-argument guard, not a reason to drop live patches.

**Synthesize a fake `process.argv[1]` in the Electron main process.** Rejected because no packaged entry is a Node module job, so the walk would always miss the load cache. Inventing a path would also perturb other readers of `argv`.

**Disable HMR again in the desktop-app bundle.** Redundant with the web-app row and does not prevent the launcher fallback, which is the packaged boot path.

## Consequences

Packaged Electron and other embedders without a CLI script path can start the same config-only HMR instance the web and headless launchers already mount. A process that does supply `argv[1]` still classifies that entry as an external when the module loader internals and load cache contain it.

Covered by `packages/boot/app-boot/tests/hmr-config.spec.ts`, which boots a config-only instance after clearing `process.argv` down to `argv[0]` and still observes an exact config path.
