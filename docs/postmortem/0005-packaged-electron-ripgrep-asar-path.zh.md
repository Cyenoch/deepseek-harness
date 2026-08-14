# 事故复盘（postmortem） 0005：打包态 Electron 把 ripgrep 解析到了 ASAR 内

[English](0005-packaged-electron-ripgrep-asar-path.md) | 中文

Status: resolved

## 摘要

打包后的桌面应用会展示 `glob` 与 `grep`，但每次调用都会在 ripgrep 启动前失败。`electron-builder` 把可执行文件放在 `app.asar.unpacked` 中，而 `@vscode/ripgrep` 返回虚拟 `app.asar` 模块路径；Electron 的 `child_process.spawn()` 无法执行该路径。源码集成测试覆盖普通 node_modules 布局，打包态冒烟测试只覆盖 `node-pty`，因此两者都通过。打包后的 main 现在通过已校验的部署覆盖提供物理可执行文件。后续审计把同一修复应用到 Linux Landlock 启动器，并修正了 Windows 原生选择器 worker 缺少 Electron Node 模式的问题。打包态冒烟测试会在接受产物前启动 Standard Agent 并执行无需密钥的本地运行路径。

## 概述

文件系统搜索会懒解析 `@vscode/ripgrep`，并把其绝对 `rgPath` 传给 subprocess 服务。在源码 checkout 中，该路径指向 pnpm 虚拟存储里的真实文件，因此能够执行。在打包态 Electron 进程中，模块解析会进入 `app.asar`，同一个包因此返回 `…/app.asar/node_modules/@vscode/ripgrep-<platform>-<arch>/bin/rg`。

可执行文件实际上位于同级的 `app.asar.unpacked` 树下。ASAR 解包控制 electron-builder 把文件写到哪里，但不会改写 `require.resolve()` 返回的字符串。Electron 支持经由虚拟归档读取模块；直接调用 `spawn()` 时仍会把虚拟路径传给操作系统，操作系统会在创建进程前拒绝该路径。

## 影响

打包后的桌面会话可以调用界面中展示的 `glob` 与 `grep` 工具，但两者都会返回带 `ripgrep launch failed` 的 `SEARCH_FAILED`。CLI、Electron 源码开发模式和包集成测试不受影响，因为它们解析到的是物理 node_modules 树。如果启动环境显式设置了有效的 `DSH_RIPGREP_PATH`，也不会触发该缺陷。

没有命令在更宽松的权限下运行。该故障会阻止文件系统发现，并用包的稳定模型可见启动诊断遮蔽操作系统报告的 `ENOTDIR` 或同类 spawn 原因。

## 时间线

- 文件系统搜索包采用 `@vscode/ripgrep` 的平台二进制，并提供可选的已校验 `DSH_RIPGREP_PATH` 部署覆盖。
- desktop 包启用了 ASAR 并列出需要解包的原生资源，但打包后的 main 没有选择物理 ripgrep 路径。
- 源码集成测试从 pnpm 的物理虚拟存储启动真实依赖并通过。
- 桌面产物冒烟测试会经由 ASAR 模块路径加载已解包的 `node-pty` prebuild 并启动 shell，但从不执行单独打包的二进制。
- 在打包后的 Electron 可执行文件内复现时，`rgPath` 位于 `app.asar` 下，直接 spawn 以 `ENOTDIR` 失败；同级 `app.asar.unpacked` 中的二进制可以成功执行。
- 打包后的 main 开始在 profile 启动前设置物理平台路径，包括后续可执行文件审计发现的 Linux Landlock 启动器。同一轮审计还让 Windows 原生选择器 worker 以仅作用于子进程的 Node 模式运行 Electron 可执行文件；产物冒烟测试也增加了真实 Standard Agent 执行。

## 根因

打包规则与运行时解析器被当作同一个机制。构建确实产出了已解包的可执行文件，但搜索消费方得到的是虚拟归档路径，因为 `@vscode/ripgrep` 通过模块解析派生 `rgPath`。代码错误地假定，解包会让这个已解析字符串可直接执行。

测试矩阵保留了这处分裂。搜索集成测试会验证真实 subprocess 与二进制，但不经过 ASAR。桌面打包测试只验证 manifest 中的解包规则。打包态运行时冒烟测试验证的是从 ASAR 加载的原生模块，其 loader 会获得 Electron 的原生模块处理；这不是文件系统搜索使用的直接可执行文件路径。没有测试同时连接打包态模块解析、物理可执行文件放置和 `child_process.spawn()` 这三个事实。

## 已添加的防护措施

- 打包后的 desktop main 会在 `runProfile()` 前把 `DSH_RIPGREP_PATH` 设为 `app.asar.unpacked/node_modules/@vscode/ripgrep-<platform>-<arch>/bin/rg[.exe]`，并在 Linux 上把 `DSH_LANDLOCK_RUN_PATH` 设为 `app.asar.unpacked/node_modules/@deepseek-ai/node-addon-landlock-run-linux-<arch>/bin/landlock-run`，同时保留启动环境显式提供的覆盖。
- [`packaged-executables.spec.ts`](../../apps/desktop/tests/packaged-executables.spec.ts) 钉住 ripgrep 与 Linux Landlock 的路径选择及覆盖优先级。
- desktop manifest 显式解包 `@vscode/ripgrep-*` 与 `@deepseek-ai/node-addon-landlock-run-*` 平台包中的可执行文件。
- [`smoke-desktop-native-module.ts`](../../scripts/smoke-desktop-native-module.ts) 会启动打包后的 desktop profile 与 Standard Agent，核对平台对应的完整工具清单，并在上传产物前执行无需密钥的文件系统、搜索、shell、job、skill、todo、协作、workflow 与 code-runtime 路径。在 Windows 上，它还会通过仅作用于子进程的 Electron Node 模式，从 ASAR 加载并打开、再中止关闭原生选择器子进程。

## 教训

- ASAR 解包保证物理放置位置，但不保证依赖解析器返回物理路径。
- 打包态原生模块冒烟测试无法覆盖独立可执行文件或 JavaScript worker；每条脱离普通模块加载的运行路径都需要执行其真实打包态调用。
- 可执行文件路径修复必须审计应用图中的每个直接 spawn 包；同一轮审计在打包态用户报告之前找到了 Linux Landlock 启动器与 Windows 原生选择器 worker 问题。
- 部署专用的归档布局由 desktop launcher 持有。共享文件系统搜索消费现有的绝对路径覆盖，并保持与 Electron 无关。
