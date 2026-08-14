# Post-mortem 0005: Packaged Electron resolved ripgrep inside ASAR

English | [中文](0005-packaged-electron-ripgrep-asar-path.zh.md)

Status: resolved

## Executive summary

The packaged desktop application exposed `glob` and `grep`, but every call failed before ripgrep started. `electron-builder` placed the executable in `app.asar.unpacked`, while `@vscode/ripgrep` returned its virtual `app.asar` module path; Electron's `child_process.spawn()` cannot execute that path. Source integration tests covered the ordinary node_modules layout, and the packaged smoke exercised only `node-pty`, so both passed. Packaged main now supplies physical executables through validated deployment overrides. The follow-up audit applied the same fix to the Linux Landlock launcher and corrected the Windows native-picker worker's missing Electron Node mode. The packaged smoke boots a Standard Agent and executes its keyless local runtime paths before accepting an artifact.

## Summary

Filesystem search resolves `@vscode/ripgrep` lazily and passes its absolute `rgPath` to the subprocess service. In a source checkout, that path points to a real file in pnpm's virtual store and works. In a packaged Electron process, module resolution enters `app.asar`, so the same package returns `…/app.asar/node_modules/@vscode/ripgrep-<platform>-<arch>/bin/rg`.

The executable is physically present under the sibling `app.asar.unpacked` tree. ASAR unpacking controls where electron-builder writes the file, but it does not rewrite a string returned by `require.resolve()`. Electron supports reading modules through the virtual archive; direct `spawn()` still passes the virtual path to the operating system, which rejects it before process creation.

## Impact

Packaged desktop sessions could call the displayed `glob` and `grep` tools, but both returned `SEARCH_FAILED` with `ripgrep launch failed`. The CLI, source Electron development, and package integration tests were unaffected because their resolved path entered a physical node_modules tree. A launching environment that explicitly set a valid `DSH_RIPGREP_PATH` also avoided the defect.

No command ran with weaker permissions. The failure prevented filesystem discovery and hid the operating-system `ENOTDIR` or equivalent spawn cause behind the package's stable model-facing launch diagnostic.

## Timeline

- The filesystem-search package adopted the platform binary from `@vscode/ripgrep` and an optional validated `DSH_RIPGREP_PATH` deployment override.
- The desktop package enabled ASAR and listed native assets for unpacking, but packaged main did not select the physical ripgrep path.
- Source integration tests spawned the dependency from pnpm's physical virtual store and passed.
- The desktop artifact smoke loaded the unpacked `node-pty` prebuild through its ASAR module path and spawned a shell, but never executed a standalone packaged binary.
- Reproduction inside the packaged Electron executable showed `rgPath` under `app.asar` and a direct spawn failure with `ENOTDIR`; the sibling `app.asar.unpacked` binary executed successfully.
- Packaged main began setting physical platform paths before profile boot, including the Linux Landlock launcher found by the follow-up executable audit. The audit also made the Windows native-picker worker run the Electron executable in child-only Node mode, and the artifact smoke added a real Standard Agent execution.

## Root cause

The packaging rule and the runtime resolver were treated as one mechanism. The build did produce an unpacked executable, but the search consumer received a virtual archive path because `@vscode/ripgrep` derives `rgPath` with module resolution. The code assumed that unpacking made this resolved string directly executable.

The test matrix preserved that split. Search integration tests verified the real subprocess and binary without ASAR. Desktop packaging tests verified the unpack rule as manifest data. The packaged runtime smoke verified an ASAR-loaded native module whose loader receives Electron's native-module handling, not the direct executable path used by filesystem search. No test joined all three facts: packaged module resolution, physical executable placement, and `child_process.spawn()`.

## Guardrails added

- Packaged desktop main sets `DSH_RIPGREP_PATH` to `app.asar.unpacked/node_modules/@vscode/ripgrep-<platform>-<arch>/bin/rg[.exe]` and, on Linux, `DSH_LANDLOCK_RUN_PATH` to `app.asar.unpacked/node_modules/@deepseek-ai/node-addon-landlock-run-linux-<arch>/bin/landlock-run` before `runProfile()`, while preserving explicit launching-environment overrides.
- [`packaged-executables.spec.ts`](../../apps/desktop/tests/packaged-executables.spec.ts) pins ripgrep and Linux Landlock path selection plus override precedence.
- The desktop manifest explicitly unpacks the `@vscode/ripgrep-*` and `@deepseek-ai/node-addon-landlock-run-*` platform-package executables.
- [`smoke-desktop-native-module.ts`](../../scripts/smoke-desktop-native-module.ts) boots the packaged desktop profile and Standard Agent, checks its exact platform tool catalog, and executes the keyless filesystem, search, shell, job, skill, todo, collaboration, workflow, and code-runtime paths before an artifact can be uploaded. On Windows it also opens and abort-closes the native-picker child loaded from ASAR through child-only Electron Node mode.

## Lessons

- ASAR unpacking guarantees physical placement, not that a dependency's resolver returns the physical path.
- A packaged native-module smoke does not cover standalone executables or JavaScript workers; every runtime path that leaves ordinary module loading needs its real packaged invocation.
- An executable-path fix must audit every direct-spawn package in the application graph; the same audit found the Linux Landlock launcher and the Windows native-picker worker before packaged users reported them.
- Deployment-specific archive layout belongs to the desktop launcher. Shared filesystem search consumes the existing absolute-path override and remains independent of Electron.
