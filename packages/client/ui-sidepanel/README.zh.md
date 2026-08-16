# @deepseek-ai/dsh-client-ui-sidepanel

[English](README.md) | 中文

侧栏插件：[ui-layout](../ui-layout/README.md) `sidepanel` 插槽的 VS Code 式标签右栏。扁平的编辑器标签承载已打开的应用（点击激活、中键或 × 关闭）；拖到另一标签条会重排或合并，拖到分区边缘会向左、右、上或下拆分。拖动标签时，悬停分区会同时显示五个停靠目标以及最终的半区或整区落位；由最近的边缘决定方向，因此角落放置不会让上、下拆分失效。+ 按钮与空分组打开启动台（书签卡片），会话头部最右侧新增开关。随附应用为 `/btw` 侧边问答（[dsh-command-btw](../../interaction/command-btw/README.md) 的问答记录 + 提问输入）与基于 libghostty 的交互终端；轨迹与 Session log 也分别贡献自己的条目。新应用只需注册一个 `sidepanel.launchpad` 条目加一个 keyed 的 `sidepanel.app` 条目，无需改动外壳。

## 机制

外壳占用 layout 拥有的 `sidepanel` 栏（session-maybe，与会话列一致：空白实例会采用首个会话且不重新挂载），并在其内声明两个座位：`sidepanel.app`（按应用 id keyed）承载标签体，`sidepanel.launchpad`（list）承载书签卡片。持久化的工作台 store（`dsh.sidepanel.workbench.<sessionId>`）按会话保存由标签分组与水平／垂直拆分组成的递归树。中心放置会合并或重排标签，边缘放置会创建拆分；关闭非根分组的最后一个标签会折叠其空分支。指针拖动的分隔条为相邻分组各保留 10% 的最小占比，获得焦点的分隔条也接受对应方向键。方向键、Home 与 End 可在各标签条内移动。应用主体会收到完整的分组内容矩形，不附带外壳留白或卡片外观；内容所需的内边距由各应用自己拥有。

每个已打开应用只在稳定的根层挂载一次，再定位到其活动分组之上。非活动应用保持挂载，标签跨分组移动也不会替换其组件，因此终端连接与应用视图状态在标签切换和拆分后均可保留。启动台卡片在打开时提供标签标题（切换语言不会重命名已打开的标签）。

`/btw` 应用的问答记录派生自会话节点快照——每个名为 `btw` 的 `command` 节点一行（问题取自已记录的 `command/run` args，答案取自 `command/done` 结果，配对未闭合时显示进行中）——其输入通过宿主 `command.execute` RPC 提交 `/btw <question>`；两侧共同渲染的持久载体是会话日志。宿主命令是组合中的任意 `/btw` 实现（base bundle 的 [dsh-command-btw](../../interaction/command-btw/README.md)）；本包从不直接对接模型或子代理。

终端是无装饰的 `ghostty-web` canvas：没有已连接／后端工具栏、边框或内部卡片留白。`ghostty-web` 会让 canvas 宿主可编辑以接收输入，因此外壳会隐藏该元素的浏览器原生光标，由 libghostty-vt 绘制终端光标。WASM 核心仅在标签拥有可见且尺寸非零的几何后加载。应用通过生成的 Remote namespace 列出当前 Agent 可用的交互式 `ctx.terminals` 后端，恢复或创建所有者本地的稳定 `sidepanel-terminal` PTY，转发原始键盘输入与 VT 输出，并同步渲染器尺寸。当固定版本的渲染器没有回答主设备属性查询时，应用会补充符合标准的响应；渲染器已回答则不会重复发送，因此登录 shell 无需等待终端能力探测。人工附加会启动操作系统账户的默认登录 shell，并保留其提示符与 profile；模型终端会话仍使用后端的受控 Bash 默认值。宿主仍负责沙箱策略、PTY 所有权、有界输出与拆卸；关闭标签或切换会话会关闭并等待所附 PTY 停稳。

外层面板几何（栏宽、拖拽与让位）属于 [ui-layout](../ui-layout/README.md)；本包只拥有内部拆分树，并调用 `ctx.layout.toggleSidepanel()`/`closeSidepanel()`。

## 组合

由 web-app bundle 与 ui-layout、ui-conversation 一同挂载（`sidepanel` 插槽与 `conversation.session.header.utilities` 座位必须已声明）。新应用是两个注册：

```ts ignore-check
ctx.slots.inject('sidepanel.launchpad', () => ctx.slots.register(
  { name: 'sidepanel.launchpad', id: 'my-app', locale: NS }, MyLaunchCard))
ctx.slots.inject('sidepanel.app', () => ctx.slots.register(
  { name: 'sidepanel.app', key: 'my-app', locale: NS }, MyApp))
```

卡片调用 owner 的 `open({ id, title })`；keyed 条目渲染标签体。

## Model Experience

None, as 侧栏渲染浏览器查看状态与 [`dsh-commands`](../../interaction/commands/README.md) 已记录的命令输出；通过输入框提问与自行键入 `/btw` 行的 token 效果相同。

#### KV Cache effect

None；本包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- **终端会话只存在于进程内**——只要宿主进程仍存活，标签即可恢复具名 PTY；harness 重启后会创建新 shell。
- **Windows 暂无随附交互后端**——在 PTY 进程树提供方达到同等支持前，Web bundle 会在 Windows 禁用 `terminal-bash`；启动卡会报告没有可用后端。
- **标签标题在打开时冻结**——切换语言会重命名启动台，但不会重命名已打开的标签；随语言重命名需要按 id 派生标题。
- **`/btw` 记录读取会话窗口**——早于已加载窗口的交流不可见，直到窗口向上翻页。
