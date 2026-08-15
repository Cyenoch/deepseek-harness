# Agent Note: Unsigned desktop GitHub Releases

Status: implemented

English | [中文](2026-08-14-unsigned-desktop-github-releases.zh.md)

## Problem

Native desktop artifacts must be built on matching macOS and Windows runners. Temporary workflow artifacts expire and do not provide a durable, commit-addressed download or checksum set for users installing the desktop application.

The repository's package, Python, Landlock, and documentation workflows are intentionally validation-only. Desktop binary distribution needs one narrow publication authority without restoring registry credentials, Pages deployment, signing secrets, or publication paths to those workflows.

## Decision

The [desktop workflow](../../../../.github/workflows/desktop.yml) is the native build, validation, and publication owner. Pull requests and manual dispatches build the supported macOS arm64 and Windows x64 artifact pairs on the standard GitHub-hosted `macos-14` and `windows-2025` runners for temporary inspection. A relevant push to `master` adds a release job after both native builds succeed.

Build jobs cache Electron runtime and electron-builder tool downloads by runner OS, architecture, and `pnpm-lock.yaml`. The desktop package disables electron-builder's native dependency rebuild because `node-pty` ships the required macOS arm64 and Windows x64 prebuilds and the ASAR policy already unpacks native assets. The package filter excludes `node-pty/build` so a host or earlier Electron build cannot shadow the target prebuild. Each matrix leg executes the packaged Electron binary with `ELECTRON_RUN_AS_NODE=1`, loads `node-pty` through `app.asar`, and executes the physical ripgrep binary under `app.asar.unpacked`. It then boots the real desktop profile, creates Standard and Cordis Agents, checks the exact platform tool catalog, exercises the keyless local tools plus the packaged shell sandbox, workflow worker, and code worker, and loads the Cordis preset's ASAR-hosted skills before accepting the artifacts. The Windows leg additionally opens and abort-closes the packaged native directory-picker worker through its child-only Electron Node mode. Already-compressed installers and archives use artifact upload compression level zero.

Master-push runs use the full commit SHA in their concurrency group and are not cancelled by later runs. Pull-request and manual runs remain grouped by ref and cancel stale work, so a later merge cannot terminate an earlier commit's release after its native builds have started.

The release job downloads only the macOS arm64 DMG/ZIP and Windows x64 NSIS/MSI workflow artifacts, requires all four nonempty files, and publishes them with `SHA256SUMS`. It receives job-scoped `contents: write`; build jobs and the workflow default retain `contents: read`. It uses the repository token through the GitHub CLI and receives no signing, notarization, registry, or other publication credential.

Each release tag is `desktop-v<desktop package version>-g<full commit SHA>`, so the tag is immutable and names its source commit without depending on a mutable `latest` tag or a version bump for every merge. The release title is `DeepSeek Harness Desktop v<version> (<first 12 commit characters>)`. A package prerelease version produces a GitHub prerelease; a stable version produces a normal release. The first run creates a draft at the triggering commit with generated notes, uploads all five assets, and publishes only after every upload succeeds. A rerun resumes an incomplete draft with `--clobber`; an already published release remains unchanged, including when the repository enforces immutable releases.

This desktop GitHub Release is the named exception to [validation-only GitHub Actions](2026-08-14-validation-only-github-actions.md). The dsh, vendored framework, Landlock Run, Python, and documentation release workflows remain validation-only and keep their existing negative guarantees.

## Alternatives considered

**Publish only through manual dispatch.** Rejected because it leaves the default branch without continuous delivery and permits operator-selected refs to become the ordinary desktop distribution path.

**Move one `latest` tag and replace its assets.** Rejected because a mutable tag loses the exact source-to-binary relationship and makes concurrent master updates race over one release.

**Keep Linux and macOS x64 validation in this workflow.** Rejected because this fork distributes only Windows x64 and macOS arm64; unsupported targets consume runner capacity without adding release evidence.

**Use a third-party release action or add signing.** Rejected because the GitHub CLI already supplies the required release operations, while signing and notarization require a separate identity, secret, and trust policy that this decision deliberately does not create.

## Consequences

Every completed relevant master-push run produces a durable GitHub Release tied to one source commit. Users receive four unsigned installers or archives plus checksums; platform trust warnings remain expected.

The application has no updater and does not consume release metadata. Publishing is an external side effect owned only by the guarded release job, and GitHub availability becomes a dependency after native build verification succeeds.

## Testing

`scripts/desktop-workflow.spec.ts` pins master concurrency, the publication guard, job-scoped write permission, supported release subset, immutable naming, checksum generation, prerelease classification, rerun behavior, download-cache keys, native rebuild and stale-build exclusion, the packaged Agent-runtime smoke, and absence of signing or registry credentials. Each native matrix leg loads the packaged `node-pty` prebuild, executes ripgrep, verifies the Standard Agent tool catalog and keyless local runtime paths, loads both Cordis authoring skills from ASAR, and checks its artifact pair before upload; the Windows leg also exercises the packaged native-picker child. The release job can therefore consume artifacts only from a successful build run.
