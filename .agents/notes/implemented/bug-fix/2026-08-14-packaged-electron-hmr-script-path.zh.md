# Agent Note: 打包后的 Electron 在没有进程脚本路径时也能启动 HMR

Status: implemented

[English](2026-08-14-packaged-electron-hmr-script-path.md) | 中文

## Problem

打包后的 DeepSeek Harness 在 Host 启动时应用 `@deepseek-ai/cordis-plugin-hmr` 失败，报错 `The "paths[0]" argument must be of type string. Received undefined`。

desktop profile 会关掉共享的模块热替换 HMR 行，随后 `runProfile` 再挂上一个只监视配置的实例（`root: []`），让 profile 和 home 的 `cordis.patch.yml` 层保持热更新。这个实例仍会读取 `process.argv[1]`，把 CLI 入口标成 external。打包后的 Electron 进程没有脚本路径，`path.resolve(undefined)` 会在 watcher 打开之前抛错。

## Decision

`vendor/hmr/src/index.ts` 只在 `process.argv[1]` 是字符串时才收集主入口 externals。缺失或非字符串的入口会留下空的 `externals` 并继续启动；只监视配置的路径和 `registerConfig()` 不变。

启动器在组合结果没有 HMR 服务时，仍然会挂上这个只监视配置的实例。打包后的 desktop 启动走这条路径，不再依赖 CLI 脚本参数。[精确配置热更新契约](2026-07-20-config-hot-reload-resilience.md)和[主 watcher 初始扫描抑制](2026-08-03-hmr-initial-scan-boot-deadlock.md)保持不变。

[嵌入式 desktop Host 决策](../architecture/2026-08-14-electron-embedded-desktop-host.md)负责应用组合和打包运行时；本记录只负责 vendored HMR 服务内部缺少入口时的行为。

## Alternatives considered

**在打包后的 Electron 里跳过只监视配置的 HMR 回退。** 否决，因为用户补丁层热更新仍是长生命周期界面的既定契约；这次崩溃是缺参数防护，不是取消热补丁的理由。

**在 Electron 主进程里伪造 `process.argv[1]`。** 否决，因为打包入口不是 Node module job，这次遍历本来也会在 load cache 里落空。捏造路径还会干扰其他读取 `argv` 的代码。

**在 desktop-app bundle 里再次禁用 HMR。** 与 web-app 行重复，也无法挡住启动器回退，而那才是打包启动路径。

## Consequences

打包后的 Electron 以及其他没有 CLI 脚本路径的嵌入方，可以启动 web 和 headless 启动器已经在用的同一套只监视配置的 HMR 实例。若进程确实提供了 `argv[1]`，并且模块加载器内部接口和 load cache 里有这项，仍会把它标成 external。

由 `packages/boot/app-boot/tests/hmr-config.spec.ts` 覆盖：把 `process.argv` 清到只剩 `argv[0]` 后启动只监视配置的实例，仍能观察到精确配置路径。
