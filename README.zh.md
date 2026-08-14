# DeepSeek Harness Desktop

[English](README.md) | 中文

基于 [Electron](https://www.electronjs.org/) 的桌面应用，将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）嵌入单一进程：Cordis Host 运行在 Electron 主进程内，官方 Web 渲染端从本地 `dsh://app` origin 加载。无需安装 Node.js，没有独立的 harness 进程，也没有本地 HTTP 服务器。

DeepSeek Harness 本身是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架），采用一切皆插件的架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

## 与其他桌面封装方式的区别

多数桌面封装会把官方 `dsh` CLI 作为子进程启动，再加载它提供的 Web UI。本仓库则直接嵌入 Host：

- **单一进程。** `runProfile()` 在 Electron 主进程内组装完整的 Cordis Host；不存在需要启动、监控或重启的 harness 子进程。
- **没有本地 HTTP 服务器。** 渲染端请求经过窄化的 preload 桥接层校验后，直接派发给 Host Connection 服务，本地不监听任何端口。
- **特权本地 origin。** Web 渲染端从 `dsh://app` 提供；客户端 bundle 从 `dsh://bundle` 加载，每个请求都必须匹配当前模块图中已登记的模块 id 和版本。
- **主进程持有原生能力。** 目录选择、会话导出保存对话框等原生服务由 Electron 主进程提供。

Harness 核心、插件系统和 Web UI 来自官方项目。命令行使用或核心开发请参考[官方仓库](https://github.com/deepseek-ai/deepseek-harness)；桌面架构见 [apps/desktop/README.md](apps/desktop/README.md)。

## 开发者预览

目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 运行桌面应用

桌面应用从本仓库源码构建，暂未提供下载：

```sh
git clone https://github.com/Cyenoch/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run dev:desktop
```

`dev:desktop` 会构建 Host 包、Web 前端和 Electron 入口，然后以常规 profile 启动应用。需要调用模型时，请设置与 `dsh` 相同的 provider 环境变量（例如 `DEEPSEEK_API_KEY`）。

### 构建安装包

在目标操作系统上构建未签名原生产物：

```sh
pnpm run package:desktop
```

`package:desktop` 会构建 Host 包、Web 前端、Electron 入口和当前平台的安装包。`package:desktop:dir` 执行相同构建，但生成未封装应用，以便更快地在本地检查。`electron-builder` 会将这两类产物写入 `apps/desktop/release/`；安装包在 macOS（arm64/x64）上为 DMG 和 ZIP，在 Linux x64 上为 AppImage 和 DEB，在 Windows x64 上为 NSIS EXE 和 MSI。产物未签名，出现平台信任警告属正常现象。[Desktop workflow](.github/workflows/desktop.yml) 会在对应的原生 runner 上构建全部四个目标并上传以供检查，不执行发布。

### 从源码运行

以标准方式从仓库源码运行 Web UI，不涉及 Electron：

```sh
pnpm install
pnpm run build
pnpm dsh web
```

该命令会启动标准 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

## 社区与支持

以下为 DeepSeek 官方项目的社区渠道：

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord 社区</a>。

桌面端相关的问题与 pull request 在本仓库跟踪。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。桌面应用内部实现位于 [`apps/desktop`](apps/desktop/README.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
