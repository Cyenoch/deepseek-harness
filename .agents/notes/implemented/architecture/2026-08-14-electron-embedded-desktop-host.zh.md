# Agent Note: Electron 内嵌桌面 Host

Status: implemented

[English](2026-08-14-electron-embedded-desktop-host.md) | 中文

## Problem

桌面应用需要共享 Web 客户端、原生对话框、单实例行为，以及可分发的 macOS、Windows 与 Linux 产物。把 Host 作为已打包子进程运行，会引入第二套运行时闭包、进程树监督、就绪信号、loopback socket 策略与平台专用启动器，而 Electron 主进程本身已经具备 Node 运行能力。

renderer 仍是不受信任的 Web 内容。Host 即使与应用同处一个进程，也不能让 renderer 获得 Node.js、原始 Electron IPC、任意文件系统读取能力或通用网络出口。

## Decision

[`apps/desktop`](../../../../apps/desktop/README.md) 是 Electron 应用，也是唯一的桌面可执行程序。其主进程调用 `runProfile({ profile: 'desktop' })`，使 Cordis Host、profile 组装、会话生命周期与原生应用生命周期同处一个进程。desktop bundle 保留共享 Host 与客户端插件图，停用 Web server 和浏览器专用启动条目，并为 Connection 服务选择 `electron` transport。

受沙箱保护的 renderer 从 `dsh://app` 加载已构建 Web frontend。主进程通过私有 `dsh:` 协议发布该文档、其静态资源和客户端插件 bundle。`dsh://bundle` 请求必须指定已注册的 package id，并携带作为缓存键的 revision query；它以 `no-cache` 提供该 id 的当前字节，因此启动 URL 在开发重建后仍可使用。Host API 调用不使用该协议：preload 暴露类型化 `ElectronRendererBridge`，每个 Fetch 请求获得一个私有 `MessagePort`，只有 renderer 请求下一块时响应 body 才继续推进。取消会传播到 Host 请求。Electron API 客户端始终以 `http://dsh.internal` 为 Host 地址。`dsh://app` 上的相对 fetch 与同文档 URL 在跨 preload bridge 之前按 protocol 与 hostname 改写到该源：特权自定义 scheme 在 Chromium 中报告非空的 `location.origin`，而 URL 规范报告 `'null'`。

desktop profile 通过 `electron` 通知载体保持客户端插件 HMR 处于活动状态。其 Host 侧 stat-poll 已注册 bundle 路径，并在内容变化后推进共享图 revision。renderer 侧通过现有 preload manifest 方法轮询该图，再使用与 Web SSE HMR 相同的串行 fiber 替换路径。`pnpm dev:desktop` 会一起启动客户端 bundle watcher 与 Electron。修改通过脚本加载的客户端插件时，Electron 进程、内嵌 Host、renderer 文档、活动 Session 对象及其他客户端 fiber 会继续运行；Web shell、main、preload、组合与仅 Host 使用的代码变更仍需重启该命令。

每个 IPC handler 只接受当前主 frame，且其 URL 必须是 supervisor 页面或 `dsh://app/index.html`。Fetch 输入、导出 URL 与文件名都会先解析再使用。`contextIsolation`、renderer sandbox、禁用 Node integration、拒绝创建窗口、拒绝 webview、阻止下载以及 allowlist navigation 策略，把 Electron 权限留在 main 与 preload 中。

Electron 不暴露 Node 内部 ESM loader。vendored Loader 的标准运行时 fallback 使用公开的 `createRequire` 解析，从配置树的 `ctx.baseUrl` 解析非相对插件名，再经动态 import 加载结果。任何不提供 Node 内部 loader 的 embedder 都因此保持同一套包归属规则，不需要 Electron 专用 alias 表。desktop 的 `package.json` 声明 Host peer 闭包，使 asar 包含 `runProfile` 会加载的每个 workspace 包；`electron-builder` 不跟随 `peerDependencies`，由 `verify-runtime-closure` 守住该列表。`app.ready` 之后，main 把 `join(app.getAppPath(), 'node_modules')` 前置到 `NODE_PATH` 并调用 `Module._initPaths()`。Electron 的 asar overlay 只对已经进入归档的路径可见，因此 `$DSH_HOME/profiles/node_modules` 指向 asar 的符号链接在磁盘上存在但无法解析；额外路径在父目录 walk 之后搜索，Loader 的 `baseUrl` 仍是 profile 目录。profile patch watcher 以 `root: []` 挂载 HMR；这一明确的仅配置模式只使用文件系统监听，而非空模块根仍要求 Node 内部 loader，并在其不可用时明确失败。

ASAR 策略把平台可执行文件留在 `app.asar.unpacked` 下。`@vscode/ripgrep` 与 Linux Landlock 入口包仍会经由虚拟 `app.asar` 模块路径解析各自的平台包，但 `child_process.spawn()` 无法执行这些路径。打包后的 main 会在 profile 启动前把 `DSH_RIPGREP_PATH` 以及 Linux 上的 `DSH_LANDLOCK_RUN_PATH` 设为匹配的物理 `app.asar.unpacked` 可执行文件，除非启动环境已经提供覆盖。每个包都会在使用前校验自己的覆盖；CLI 与开发态 Electron 继续使用普通包解析。

macOS 通过 Finder 与 Dock 启动应用时携带的是精简的 GUI 会话环境，而不是用户登录 shell 导出的变量。在 profile 启动前，desktop main 会以登录且交互模式运行一次配置的绝对登录 shell，通过带 marker 的 NUL 流只读取其导出环境，并补入 Electron 继承环境中缺失的变量。PATH 是唯一采用追加策略的值：继承条目保持在前，登录 shell 中缺失的条目追加在后，因此终端显式提供的解析顺序仍然优先，而 GUI 启动可以找到 Homebrew、pnpm 与版本管理器工具。易变的 shell 内部状态会被忽略。五秒超时、输出上限、不完整 marker 拒绝和仅警告的回退机制可防止 profile 代码无限阻塞应用启动；shell 启动失败时，继承环境仍可使用。

Electron 持有原生目录选择器后端与会话导出保存对话框。desktop profile 显式挂载原生选择器客户端界面，使 Hero 与侧边栏 Workspace 入口在禁用 Web profile 的自适应选择器 row 后仍连接到该实现。在 Windows 上，选择器会在 JavaScript 子进程中运行阻塞式 COM 调用，其入口保留在 ASAR 内可读；只有当前 Electron 可执行文件的这次调用会收到 `ELECTRON_RUN_AS_NODE=1`，与打包后的 ACL runner 一致，且不会改变 main 的运行模式。导出数据从内嵌 Host 直接流入 mode 为 `0600` 的文件，并在失败后删除未完成文件。一个应用实例持有该 profile。关闭主窗口只会将其隐藏，内嵌 Host 与正在执行的任务会继续运行；托盘或菜单栏图标、macOS Dock 激活与再次启动应用都会恢复同一个窗口。只有显式退出应用才会开始 Host 有界关停，并在进程退出前提供八秒宽限。

macOS 上主 `BrowserWindow` 使用 `hiddenInset`，红绿灯按钮位于 `x=12`、`y=12`。preload 的 `ElectronRendererBridge` 报告类型化的 `macos-hidden-inset` chrome 模式；renderer 围绕 14px 控件平衡侧边栏顶部间距，并在可交互控件上方暴露 32px 透明拖动条。其他平台保持默认 chrome。

`electron-builder` 从 desktop 包的闭合依赖图打包无签名的 macOS DMG／ZIP、Windows NSIS／MSI 与 Linux AppImage／DEB 产物。不再保留 Tauri、Rust 桌面 crate、后端 sidecar、桌面 SEA、就绪 socket 或单独打包的 Windows ACL runner。在 Windows 上，普通 ACL runner 脚本通过 Electron 可执行文件启动；只有该子进程调用的 `ConfinedArgv.environment` 携带 `ELECTRON_RUN_AS_NODE=1`。

## Alternatives considered

**Tauri 壳加已打包 Host 子进程。** 拒绝，因为它复制 JavaScript 运行时闭包，并为 Electron 已持有的能力增加监督、就绪、loopback 安全、多个原生产物与 Rust 应用代码。

**Electron main 加 HTTP Host 子进程。** 拒绝，因为只替换窗口工具包仍会保留多余的进程、socket 与生命周期故障模式。

**向页面暴露 `ipcRenderer` 或 Node integration。** 拒绝，因为任何 renderer 入侵都会获得通用原生能力，而不是应用所需的三项操作。

**通过 `dsh://` 承载 Host API 请求。** 拒绝，因为自定义协议适合不可变的应用自有 bundle 读取，而请求／响应流、背压与取消需要类型化私有通道。

**把 Loader `baseUrl` 指到 asar。** 拒绝，因为 profile 目录持有相对配置解析与用户插件；把 `baseUrl` 压到安装目录会跳过 profile 的 `node_modules` walk。

**把整个 `node_modules` 从 asar 解包。** 拒绝，因为它在磁盘上复制整份 JavaScript 图。`NODE_PATH` 无需解包这些包即可到达归档。

**让文件系统搜索包推断 Electron 的解包路径。** 拒绝，因为 ASAR 布局属于 desktop 部署，而 `@deepseek-ai/dsh-tool-fs-search` 也运行于 CLI、远程环境和非 Electron embedder。其现有的已校验部署覆盖可以携带物理可执行文件路径，无需给该包增加 Electron 布局知识。

**把固定的包管理器目录加入 PATH。** 拒绝，因为 Homebrew 前缀会随架构变化，用户也可能依赖 nvm、pyenv、mise 或其他由 shell 管理的位置。登录 shell 已经是这些导出值的用户侧真源。

**用登录 shell 环境替换 Electron 环境。** 拒绝，因为终端、CI launcher 或显式 desktop wrapper 可能有意为该应用提供变量与 PATH 优先级。除追加 PATH 中缺失的目录外，登录 shell 值只填补空缺。

**把安装包复制进 `$DSH_HOME`。** 拒绝，因为它分叉安装图并会过期。

## Consequences

桌面产物大于系统 WebView 壳，因为它交付 Chromium 与 Electron。打包现在只遵循一份 JavaScript 依赖图与一个应用生命周期；renderer 仍与载体无关，浏览器 profile 继续持有 HTTP／WebSocket 访问。在 macOS 上，应用启动时还会运行一次用户常规的登录与交互 shell 启动文件；直接提供的启动变量保持更高优先级，探测失败不会阻止 Host 启动。

[桌面发布工作流](../process/2026-08-14-unsigned-desktop-github-releases.md)会发布无签名的 Windows x64 与 macOS arm64 安装程序。应用不包含 updater；签名、公证与自动更新策略仍是独立的分发决策，而不是隐含的运行时行为。

## Testing

源码 Playwright `_electron` e2e（`apps/web/tests/desktop-profile.e2e.ts`）钉住 renderer 载体与 Standard mode，在 macOS 上以精简 GUI PATH 和临时登录 shell 导出值启动 Electron，验证 main 能恢复该导出值与目录，并证明关闭原生窗口只会隐藏窗口且进程继续运行，随后显式退出能干净结束。Desktop 单元测试钉住协议、IPC 校验、登录 shell 输出解析与合并优先级、应用图 `NODE_PATH` 解析、打包态可执行文件路径选择、Electron 子进程 Node 模式及 manifest revision 轮询。CI 在 `electron-builder` 之前校验 desktop manifest 的运行时闭包；其打包态运行时冒烟测试会在全新的 `$DSH_HOME` 下启动真实 desktop profile、创建 Standard Agent、核对平台对应的完整工具清单，并执行无需密钥的文件系统、搜索、shell、job、skill、todo、协作、workflow 与 code-runtime 路径。同一冒烟测试会加载打包后的 `node-pty` prebuild、直接执行已解包的 ripgrep 二进制；其 shell 调用经过生产沙箱实现，包括打包后的 Windows ACL runner。Windows 矩阵项还会打开并中止关闭打包后的原生目录选择器 worker，以证明第二个 Electron Node 模式子入口。未封装的 macOS arm64 `electron-builder --dir` 产物能在全新 `$DSH_HOME` 下启动内嵌 Host：主窗口为 1280×800，并显示 Choose workspace 与 Standard mode。实时开发探针在 Electron／Host PID 不变时修改并恢复了 `ui-conversation` Hero 标题，同时复现了共享 HMR 路径中 Hero 输入区恢复不完整的已知问题。
