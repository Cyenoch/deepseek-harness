# Naming

## npm packages

The public package family belongs to the `@deepseek-ai` scope and uses the `node-addon-landlock-run` package prefix; platform packages append platform information only:

```text
@deepseek-ai/node-addon-landlock-run
@deepseek-ai/node-addon-landlock-run-<platform>
```

Platform suffixes carry no libc component (binaries are static musl) and no variant component — variants stay inside `prebuilds.json` and binary filenames.

## Binaries

The launcher executable is `landlock-run`, shipped at `bin/landlock-run` inside each platform package.

## Environment variables

The `NALR_` prefix (Node Addon Landlock Run) is reserved for build/test orchestration:

```text
NALR_REQUIRE_LANDLOCK   test-only: an unenforcing kernel fails instead of skipping
```

`DSH_LANDLOCK_RUN_PATH` is the desktop disk override: a nonblank value must be an absolute regular file, and `launcherPath()` does not consult the npm platform package. Unset, empty, and whitespace-only values keep platform-package resolution. Do not include the npm scope in environment variable names.

## C symbols

The launcher is a single C file with static linkage; there is no exported symbol namespace. Kernel UAPI constants keep their kernel names prefixed `LL_` where locally defined.
