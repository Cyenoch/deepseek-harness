# Post-mortem 0007: Packaged Cordis Agent dropped ASAR-hosted skills

English | [中文](0007-packaged-cordis-skills-asar-stats.zh.md)

Status: resolved

## Executive summary

The packaged desktop Cordis Agent advertised a workflow that required `cordis-plugin-development`, but loading that skill returned “unknown or no longer available.” Both skill files were present and readable inside `app.asar`. Electron returned ordinary numeric `Stats` for a bigint stat request, and `dsh-fs-local` mixed the numeric mode with a bigint mask while discovering the directory. Source tests used a physical filesystem, and packaged smoke created only a Standard Agent with a workspace skill, so neither represented an ASAR-backed skill root. Filesystem metadata normalization now follows the returned runtime types, and packaged smoke loads both Cordis authoring skills through the real Agent tool.

## Summary

The shipped Cordis preset keeps `cordis-plugin-development` and `editing-cordis-compositions` beside its composition under `config/agent-presets/cordis/skills`. Its scoped `dsh-skill-filesystem` provider discovers that custom root through `ctx.fs`, and `dsh-tool-skill` loads the selected definition.

In a source checkout, the root is an ordinary directory and Node honors `stat(path, { bigint: true })`. In a packaged desktop application, the same path enters Electron's virtual `app.asar` filesystem. Electron can list and read the files, but its ASAR stat implementation returns ordinary number-valued `Stats` even when the bigint overload is requested.

## Impact

Cordis Agent sessions in the packaged desktop application could not load either authoring skill from the shipped preset. The system prompt still instructed the model to call `skill` with `cordis-plugin-development`, so the failure appeared as a missing or obsolete skill even though the installation contained it.

Standard Agent workspace skills and ordinary project files remained available because they lived on the physical filesystem. Other tools in the Cordis preset could still mount, which isolated the visible failure to skill loading.

## Timeline

- The Cordis preset shipped both authoring skills and source-composition coverage confirmed its scoped skill provider.
- Desktop artifact smoke booted the real packaged profile but created only a Standard Agent and loaded a temporary workspace skill.
- A packaged Cordis Agent reported `skill "cordis-plugin-development" is unknown or no longer available`.
- ASAR inspection confirmed both files were present and direct Electron `readdir` and `readFile` calls succeeded.
- Capturing the skipped-provider warning exposed `Cannot mix BigInt and other types` during `ctx.fs.listDir`.
- `dsh-fs-local` began normalizing ordinary and bigint stat results, and packaged smoke added a Cordis Agent that loads both installed skills.

## Root cause

`dsh-fs-local` trusted Node's TypeScript overload for `stat(path, { bigint: true })` and immediately evaluated `info.mode & 0o777n`. Electron's ASAR implementation accepts that call but returns number-valued fields. The bitwise operation therefore threw before directory discovery could return a candidate.

The skill registry intentionally contains a failing provider, marks the observation incomplete, and logs the provider error so unrelated providers remain usable. The requested skill had no remaining candidate, so the model-facing tool produced its ordinary unknown-skill diagnostic. That final error hid the filesystem metadata mismatch unless the runtime warning was inspected.

Every earlier check exercised a different environment. Filesystem unit tests ran against native Node, which obeyed the bigint overload. The preset e2e used the source configuration directory on a physical disk. Artifact inspection proved file inclusion but not provider traversal. The packaged runtime smoke exercised a workspace skill under a temporary physical directory and never mounted the Cordis preset.

## Guardrails added

- `normalizeStatIdentity` selects bigint nanosecond metadata or ordinary millisecond metadata from the actual field types and applies the matching numeric mode mask.
- [`fsio.spec.ts`](../../packages/fs/fs-local/tests/fsio.spec.ts) passes both real ordinary `Stats` and `BigIntStats` through that normalization.
- [`web-agent-presets.e2e.ts`](../../apps/cli/tests/web-agent-presets.e2e.ts) requires the Cordis composition to discover both authoring skills and load the full plugin-development body.
- [`smoke-desktop-native-module.ts`](../../scripts/smoke-desktop-native-module.ts) creates a Cordis Agent inside the packaged Electron runtime, checks both ASAR-hosted skill names, and executes the real `skill` tool for `cordis-plugin-development`.

## Lessons

- A Node-compatible virtual filesystem may accept an overload without returning the native field representation promised by Node's types; filesystem adapters must normalize observed runtime values.
- File-presence checks do not prove that a service can traverse and parse packaged resources through its production abstraction.
- A packaged Agent smoke must cover preset-specific resources, not only tools and files shared with the default preset.
