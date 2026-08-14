# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

Electron 桌面组合层。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.md) 之上，禁用 HTTP 服务器、Web startup 与自适应目录选择 row，为 Connection 服务选择 `electron` transport，为客户端 HMR 服务选择 `electron` manifest transport，并在本包的 `desktop-app` 插件之外挂载原生目录选择器客户端界面。

Electron main 进程会在 profile 组合前提供用于排序的 `ctx.desktopRuntime` 与原生目录选择实现。配对的客户端界面让两个 Workspace 选择入口都连接到该实现。Connection Host 无需打开 socket 即可暴露 Fetch 分发器；客户端模块注册表保留共享模块图与已构建 bundle 路径，但不注册 `/plugins` route。HMR node 侧监视这些路径并推进图 revision；Electron 客户端侧通过 preload 读取 revision，并替换发生变化的客户端 fiber。原生生命周期与 IPC 权限归 [`apps/desktop`](../../../apps/desktop/README.md) 持有，而不在本 bundle 内。

## 模型体验

### Desktop surface 上下文

#### 模型可见内容

`app:desktop-surface` 全局 section（order −98）把 Electron desktop application 标识为当前用户界面，并据此定义“this window”“this GUI”和“this app”。它明确说明模型不会隐式获得 DOM、route、screenshot 或 native-computer context。

#### Token 影响

每次 model request 增加一个固定 prompt 段落；本 bundle 不增加 tool schema 或 tool result。

#### KV Cache 影响

该段落位于 system prompt 前部，并在 desktop profile 的整个生命周期内保持不变，因此不会在轮次之间使 cache 失效。

## 已知限制与延期工作

- **服务由 Electron 持有**：通过通用 CLI 启动 desktop profile 不会创建原生窗口或 preload bridge；受支持的应用入口是 `apps/desktop`。
- **没有网络载体**：禁用 Web 服务器是有意行为。远程浏览器访问必须使用独立的 `web` profile 及其信任策略。
