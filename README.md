# DeepSeek Harness Desktop

English | [中文](README.zh.md)

An [Electron](https://www.electronjs.org/) desktop application that embeds [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) in a single process: the Cordis Host runs inside Electron's main process, and the official Web renderer loads from a local `dsh://app` origin. No Node.js installation, no separate harness process, and no local HTTP server.

DeepSeek Harness itself is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com), built on an everything-is-a-plugin architecture powered by [Cordis](https://github.com/cordiverse/cordis).

## How this differs from other desktop packaging

Most desktop packaging starts the official `dsh` CLI as a child process and loads the Web UI it serves. This repository instead embeds the Host directly:

- **Single process.** `runProfile()` composes the full Cordis Host inside Electron's main process; there is no child harness process to spawn, monitor, or restart.
- **No local HTTP server.** Renderer requests cross a narrow validated preload bridge and are dispatched straight to the Host Connection service, so nothing listens on a local port.
- **Privileged local origin.** The Web renderer is served from `dsh://app`; client bundles load from `dsh://bundle` and every request must match a module id and revision in the current graph.
- **Native capabilities in main.** Directory picking, session-export save dialogs, and other native services are owned by the Electron main process.

The harness core, plugin system, and Web UI come from the official project. For CLI usage or core development, see the [upstream repository](https://github.com/deepseek-ai/deepseek-harness); for the desktop architecture, see [apps/desktop/README.md](apps/desktop/README.md).

## Developer preview

Currently in _developer preview_ and iterating rapidly. **There will be compatibility-breaking changes.**

## Run

### Run the desktop application

The desktop application is built from this repository; there is no published download yet:

```sh
git clone https://github.com/Cyenoch/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run dev:desktop
```

`dev:desktop` builds the Host packages, Web frontend, and Electron entries, then starts the application with the normal profile. Set the same provider environment variables used by `dsh` (for example `DEEPSEEK_API_KEY`) when exercising model calls.

### Build installers

Build unsigned native artifacts on the target operating system:

```sh
pnpm --dir apps/desktop run build
```

`electron-builder` writes DMG and ZIP on macOS (arm64/x64), AppImage and DEB on Linux x64, and NSIS EXE and MSI on Windows x64, under `apps/desktop/release/`. Artifacts are unsigned; platform trust warnings are expected. The [Desktop workflow](.github/workflows/desktop.yml) builds all four targets on native runners and uploads them for inspection without publishing.

### Run from source

To run the standard Web UI from a repository checkout, without Electron:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

This starts the standard Web UI at `http://127.0.0.1:3080` with no Electron involved. See the [Web UI guide](docs/user/guide/index.md).

## Community and support

The following channels belong to the upstream DeepSeek Harness project:

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

Desktop-specific issues and pull requests are tracked in this repository.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md). Desktop application internals live in [`apps/desktop`](apps/desktop/README.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
