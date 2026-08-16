# Agent Note: 侧栏面板——带启动台的标签式右栏

Status: implemented

[English](2026-08-15-side-panel-tabbed-right-column.md) | 中文

## Problem

Web 客户端没有持久的右侧工作面：工具调用详情占据一个狭窄的瞬态栏，`/btw` 回答以内联命令卡片渲染，终端则无处安放。诉求是一个浏览器式侧栏——自己的标签、空态启动台、可拖拽宽度、可为未来应用扩展——由会话头部最右侧的开关唤出。

## Decision

按插槽系统已有的 frame/plugin 分界拆分：

- **[ui-layout](../../../../packages/client/ui-layout/README.md) 拥有几何。** AppFrame 增长为第四轨（`sidebar | center | details | sidepanel`），让位链按契约次序扩展——details 先收缩再自动关闭，随后侧栏面板收缩再自动关闭；侧栏面板优先于 details，因为它承载进行中的侧边工作，而 details 是瞬态检视。新常量（`SIDEPANEL_MIN/MAX/DEFAULT` = 320/720/420，比 details 宽以供终端使用）、复用 details 药丸模式的新拖拽手柄、以及 `sidepanel` 子插槽（single、`session-maybe`，与会话列一致——切换会话保持组件身份，不受会话门控）。layout store 增加 `sidepanel` 宽度与开/关/切换动作，并从瞬态转为持久化（`localStorage` 键 `dsh.layout`）：拖拽宽度与开合偏好跨刷新保留，视口派生的窄屏对在挂载时自校正。`ctx.layout` 新增 `toggleSidepanel`/`openSidepanel`/`closeSidepanel`。
- **[ui-sidepanel](../../../../packages/client/ui-sidepanel/README.md) 拥有工作台。** 一个包向 layout 的 `sidepanel` 插槽注册外壳，并在其内声明两个座位：`sidepanel.launchpad`（list——书签卡片）与 `sidepanel.app`（按应用 id keyed——标签体）。按会话持久化的工作台 store（`dsh.sidepanel.workbench.<sessionId>`）保存由标签分组与水平或垂直拆分组成的递归树。标签放到标签条可重排或合并，放到分区边缘可向左、右、上或下拆分；关闭空的非根分组会折叠其分支。拆分方向由最近的边缘决定，五目标停靠引导和实时落位遮罩会在放下前展示结果。指针或键盘可调的分隔条会在两侧各保留相邻尺寸的 10%。无标签打开时——或经 + 按钮——分组渲染启动台。每个已打开应用只在稳定的根层挂载一次，再定位到所属分组之上，因此非活动标签与跨组移动的标签均保留终端连接与视图状态。外壳把完整的分组内容矩形交给各应用，不附带内边距或卡片外观；应用拥有自己的内边距。扁平、连续的标签条支持方向键、Home、End 和中键关闭。会话头部的 utility 条目贡献最右侧开关。新应用是两个注册（一张启动台卡片 + 一个 keyed 条目），外壳零改动；标签标题在打开时冻结（由启动台文案提供）。
- **随附的 `/btw` 应用是持久日志之上的纯客户端视图。** 其问答记录派生自会话节点快照——每个名为 `btw` 的 `command` 节点一行（问题取自已记录的 `command/run` args，答案取自 `command/done` 结果，配对未闭合时显示进行中）——其输入通过宿主 `command.execute` RPC 提交 `/btw <question>`，与 composer 同一通道。侧栏面板从不对接模型或子代理；由组合中的任意 `/btw` 实现作答。
- **终端是对既有 PTY 能力的人工附加。** `dsh-terminal` 公开 Agent 作用域的生成式 Remote namespace，用于适用后端发现、具名附加／恢复、有界游标读取、原始输入、尺寸调整和关闭。`terminal-bash` 在保持原有模型清理输出不变的同时增加有界原始 VT 流；人工呈现会启动操作系统账户的登录 shell，不注入只供模型使用的提示符或 pager 覆盖，显式的人工 shell 配置仍可替换该选择，而模型呈现继续使用受控 Bash。`subprocess` 提供可选 PTY resize，并把调用方的有效 `TERM` 保留为 PTY 终端类型。Client 只会在保留的标签主体具有非零尺寸后加载 `ghostty-web`，并用其内嵌的 libghostty-vt WASM 核心渲染该流。终端表面只保留无装饰的 canvas，不含连接／后端工具栏或内层卡片外观。由于 `ghostty-web` 会让宿主元素可编辑以接收键盘输入，外壳会隐藏浏览器原生光标，仅由 libghostty-vt 渲染终端光标。只有当渲染器没有回答时，Client 才会补充固定版本渲染器遗漏的主设备属性响应，使登录 shell 无需超时即可完成终端能力探测。宿主继续拥有沙箱策略、Agent 权限、输出上限与进程树拆卸。浏览器安全的 Remote payload 位于 `dsh-terminal/remote-types`，因此 Client program 不会导入只供 Host 使用的 `Agent` 或 Node 类型。
- **每种客户端载体都显式声明终端的启动要求。** 侧栏 Client 注入它读取的精确 `remote.terminals` 服务。在 Web bundle 中，module 与 HMR 插件会等待 `webServer`，确保 Client module graph 启动前 index tap 与 carrier 已生效。桌面 patch 会把该激活依赖替换为 `desktopRuntime`，因为 Electron 无需 HTTP 服务器即可读取 module graph 与 bundle 路径。Web CSP 允许 `ghostty-web` 内嵌 WebAssembly 模块所需的 `data:` 获取与 `wasm-unsafe-eval`，但不启用 JavaScript `eval`。
- **空白侧栏故障在插槽框架 seam 修复。** `session-maybe` 条目会刻意保持同一个 React 实例，让其空白状态采用首个 Session。因此，已声明的 store 在空白状态也必须保留一个始终可调用的 selector Hook；此前缺失该 Hook，导致 `SidePanelRoot` 在采用会话后多调用一个 Hook，React 因而拒绝渲染。`PropsStoreFor` 现在表达 maybe-store face，`web-react` 会在 Session 出现前提供稳定的 maybe selector Hook，而 actions 仍在 store 存在前保持缺席。真实 registry/renderer 全链路回归覆盖空白到首个会话的采用过程。

## Alternatives considered

- **把 details 栏复用为侧栏宿主**——拒绝：details 受会话门控、宽 300–520px、切换会话即自动关闭；终端需要宽度与连续性，且接管该插槽会挤掉工具调用详情而非与之并置。
- **从 keyed 注册表发现启动台条目**——拒绝：插槽系统不向占用者暴露注册元数据，为标签枚举条目取名将形成第二条读取路径；改为每个应用注册一张启动台卡片（自己的文案与图形）加一个 keyed 主体，路由权威保持在注册点。
- **像参考侧栏一样使用 xterm.js**——拒绝：其标签生命周期和零尺寸挂载经验适用，但本集成明确要求 libghostty WASM。`ghostty-web` 通过与 xterm 兼容的终端 API 提供 libghostty-vt 解析器，因此宿主传输仍与渲染器无关。
- **把应用主体直接渲染在递归分组叶节点内**——拒绝：把标签移到其他叶节点会替换其 React 子树，关闭已附加的终端并丢失局部视图状态。稳定的根应用层把组件身份与拆分树几何分离。
- **只持久化侧栏宽度**——拒绝：一个几何事实将拥有两个归属（layout store 中的活值与别处的持久偏好）。持久化整个 layout store 保持单一归属，同时改善侧栏宽度的持久性；瞬态契约是 README 记录的决策，随本变更一并更新。

## Consequences

- 两个右栏可以同时打开；让位链决定性地处理挤压，center 始终保住 `CENTER_MIN` 直至最终回退。
- `/btw` 交流在会话（通用命令卡片）与侧栏标签中同时可见——一份持久记录、两个视图；侧栏标签额外提供提问输入。
- 标签分组与拆分树按会话存储（store 作用域跟随 session-maybe 条目）：切换会话会切换工作台；各 Session 的布局经作用域键跨刷新持久。
- 关闭终端标签或切换其 Session 会关闭并等待该 Agent 附加的 PTY 停稳；激活其他标签或把终端跨组移动都不会卸载终端，连接保持不变。
- 在 Windows PTY 提供方达到同等的交互与进程树保证前，Windows Web 组合会禁用 `terminal-bash`。

## Verification

`ui-layout`：求解器 spec 覆盖两个新让位步骤（details-先于-sidepanel 次序、四轨接缝、纯恢复），store spec 覆盖侧栏动作集与持久化往返，AppFrame spec 覆盖第四轨、其手柄、会话无关性与让位。`ui-sidepanel` 覆盖四个边缘拆分方向、五目标预览状态、中心合并与重排、空分支折叠、分隔条尺寸调整、持久化树状态、启动台路由、浏览器拖拽中的稳定应用身份、键盘与中键手势、`/btw`、每个 Terminal Remote 适配器、无装饰 libghostty 生命周期、原生光标隐藏、分片主设备属性查询，以及真实 registry/renderer 的空白到会话全链路渲染。`web-react` 另行钉住始终可调用的 maybe-store Hook。终端 service/backend 测试覆盖权限、附加／恢复／回滚、请求上限、原始流截断／取消／终态、原始输入、账户登录 shell 选择与显式覆盖、人工 `TERM`、PTY 终端类型传递、resize 与清理。Web replay 会打开真实组合的启动台，加载并连接 libghostty 终端，操作轨迹与 Session log 应用，并断言没有插槽、页面或控制台错误。
