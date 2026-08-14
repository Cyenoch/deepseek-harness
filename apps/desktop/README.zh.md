# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 原生应用。该私有工作区把 Electron、现有 Web renderer 与在 Electron main 进程内运行的 `desktop` Cordis profile 打包在一起。应用不启动本地 HTTP 服务器或 harness 子进程：renderer 请求经过窄 preload bridge，由 main 直接分发给 Host Connection 服务。

可复用的内嵌、IPC 与打包约束汇总在[用 Electron 包装 DSH](../../docs/cookbook/wrapping-dsh-with-electron.md)中。

## 运行时行为

Electron 在 `runProfile()` 组合内嵌 Host 期间先打开本地 supervisor 页面。Main 在组合前提供原生目录选择服务，读取已稳定的客户端模块图，然后通过特权 `dsh://app` 源提供 [`apps/web/dist`](../web/dist)。客户端 bundle 使用 `dsh://bundle` 协议；模块 id 选择已注册 bundle，revision query 是它的缓存键。HMR 期间，现有启动 URL 会按设计以 `no-cache` 读取该 id 的当前字节。

macOS 上主 `BrowserWindow` 使用 `hiddenInset`，红绿灯按钮位于 `x=12`、`y=12`。renderer 获得类型化的 `macos-hidden-inset` chrome 模式，围绕 14px 控件平衡侧边栏顶部间距，并在可交互控件上方暴露 32px 透明拖动条。其他平台保持默认 chrome。

Renderer 启用 `contextIsolation`、Chromium 沙箱与 Web 安全，禁用 Node integration。Preload 只暴露 manifest 查询、Fetch 打开／读取／取消、会话导出保存与 supervisor 状态方法。Fetch IPC 只接受 `http://dsh.internal`，校验方法、header、body 大小与 main-frame 发送方，再通过私有 `MessagePort` 按 renderer 拉取节奏流式发送响应 chunk。即使文档源是 `dsh://app`，renderer 客户端也会把 Host URL 固定到该源。外部导航、新窗口、webview 与 Chromium 下载全部拒绝。

会话导出仍是唯一可由 renderer 请求的原生文件写入。Main 只接受带必需查询字段的 `/api/session.export` 和安全的 `dsh-session-*.zip` 文件名，显示 Electron 保存对话框，把 Host 响应流式写入 mode-0600 文件，并在失败后删除残缺文件。目录选择通过现有 Host capability 使用 Electron 目录对话框。

关闭主窗口只会将其隐藏，内嵌 Host 与正在执行的任务会继续运行。左键点击托盘或菜单栏图标、选择 **Show DeepSeek Harness**、在 macOS 激活 Dock 图标，或再次启动应用，都会恢复并聚焦现有窗口。托盘上下文菜单还提供 **Quit**；只有显式退出应用才会 dispose profile，八秒宽限避免 teardown 无限阻塞退出。

## 开发

在仓库根目录执行：

```sh
pnpm install
pnpm dev:desktop
```

`dev:desktop` 会构建一次 Host 包、Web frontend、main entry 与 preload，启动客户端插件重建 watcher，再以正常 profile 与 `$DSH_HOME` 启动 Electron。修改通过脚本加载的客户端插件 TypeScript、TSX 与 CSS 时，只会重建并替换受影响的客户端 fiber；Electron 进程、内嵌 Host、renderer 文档、活动 Session 对象及其他客户端 fiber 会继续运行。由被替换插件持有的本地 React 状态会重新创建。

修改 Web shell、Electron main 或 preload、profile 组合及仅 Host 使用的代码时，仍需重启 `pnpm dev:desktop`。需要实际调用模型时，请设置与 `dsh` 相同的 provider 环境变量。

在目标操作系统上构建无签名原生产物：

```sh
pnpm --dir apps/desktop run build
```

`electron-builder` 把产物写入 `apps/desktop/release/`：macOS 为 DMG 与 ZIP，Linux 为 AppImage 与 DEB，Windows 为 NSIS EXE 与 MSI。`pnpm --dir apps/desktop run pack` 会创建可供本地检查的未封装应用。桌面工作流使用 GitHub 标准托管的 `macos-14` 与 `windows-2025` runner 构建受支持的 macOS arm64 和 Windows x64 目标，校验每组产物，并将其作为临时工作流产物上传。相关变更推送到 `master` 后，工作流会把两组产物和 `SHA256SUMS` 发布为无签名 GitHub Release。tag 为 `desktop-v<version>-g<完整 commit SHA>`，标题为 `DeepSeek Harness Desktop v<version> (<commit 前 12 个字符>)`。

组合包包含仓库许可证、生成的 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)、Web distribution，以及 desktop 包的生产 `dependencies`。该列表是闭合的 Host peer 图：`electron-builder` 只跟随 `dependencies`，因此 `runProfile` 会加载的每个 workspace 包——包括 Service Definition peer——都必须写在这里。CI 在打包前对该 manifest 运行 `verify-runtime-closure`。原生 Node addon 与可执行文件会在其 loader 需要文件系统路径时从 ASAR 解包。打包后的 `node-pty` 使用其随包提供的 macOS arm64 与 Windows x64 prebuild，而不执行 Electron rebuild；包会排除其 `build/` 目录，防止 host 或陈旧的 Electron 二进制文件遮蔽目标 prebuild。每个 CI 矩阵项都会以 Node 模式运行打包后的 Electron 可执行文件，并通过该模块启动 shell，成功后才上传产物。

在 `runProfile` 之前，main 把 `<application path>/node_modules` 前置到 `NODE_PATH`，并重建 Node 的额外模块搜索路径。Loader 的 `createRequire` 仍锚定在 profile 目录：profile 本地包优先，然后是父目录 walk，然后是应用图。已打包的 `app.asar` 只对已经进入归档的路径可见，因此 profile fallback 指向 asar 的符号链接无法解析。

## 已知限制

- **产物未签名**：代码签名与公证被有意排除，因此预计会出现平台信任警告。
- **没有 updater**：GitHub Releases 分发安装程序，但应用不会发现或应用更新。
- **拒绝外部导航**：应用不会从 renderer 导航推断可信用户手势，因此不会自动打开外部链接。
