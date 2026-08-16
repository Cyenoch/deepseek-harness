# Agent Note: 基于 fork 临时子会话的 BTW 侧边问题

Status: implemented

[English](2026-08-15-btw-side-questions.md) | 中文

## Problem

用户想就当前会话问一个快问题——"改了什么？""为什么失败？"——而不把它变成对话历史，也不干扰进行中的任务。同类产品定下了形态：OpenClaw 的 `/btw` 把会话上下文快照进一次性侧边查询，答案只展示、绝不写入主 transcript；Codex `/side` fork 出带护栏的临时侧线程，防止继续父线程的工作。现有原语没有提供这个产品面：session-store fork 是无归属的，fork subagent 是折叠进单个工具结果的模型驱动运行。更早的[交互式侧会话提案](../../proposed/feature/2026-07-08-interactive-side-sessions.md)设计了与客户端无关的机制；本笔记记录已交付的部分。

## Decision

`/btw <question>`（[`dsh-command-btw`](../../../../packages/interaction/command-btw/README.md)，由 base bundle 挂载）通过 `ctx.agents.create` 把接收 agent 已完成轮次的平衡前缀 fork 成一个新子会话，复用 [`dsh-subagent`](../../implemented/feature/2026-06-21-subagent-capability-seam.md) 的共享子组合：`childSessionMeta` 血缘（`parentSession`、`seedLength`、`origin: 'subagent'`、`delegationDepth`）、委托策略种子（审批固定 `never`），以及原样加入父会话 preset 的 `applyChildComposition`。子会话的路由取自父会话日志中最后一条 `request/header` 的 config，父会话创建时的 `AgentOptions` 只作回落：会话中途切换模型（Web 模型选择器）只更新该日志，创建时的种子会过期，因此仅从 `AgentOptions` 播种会把子会话发往父会话创建那一刻的全局默认——线上即观察到每个 `/btw` 子会话都路由到已损坏的默认提供方，而父会话自身请求运行在切换后的路由上。一条部署配置的顾问上下文消息（`source: { kind: 'plugin', plugin: 'command-btw' }`）注入在问题之前；问题是子会话唯一的 follow-up 轮次；子的最终 assistant 输出成为 `command/done` 文本，子 agent 随即销毁。

与提案的偏差及理由：

- **无合并回写。** 提案中带长度上限的回写父会话保持延后：两个产品参照都是严格临时的（"不污染未来上下文"），用户诉求也只要求展示。合并回写仍是提案的开放扩展点。
- **`origin: 'subagent'`，而非普通 fork。** 通过 `childSessionMeta` 盖章保持了单一的子会话血缘词汇，并让临时子会话不出现在普通侧栏；会话切换与专属呈现属于未来客户端 UI，提案本就如此划分。
- **顾问框架是一条注入消息，而非系统提示修改。** 遵循提案的缓存理由：子会话的前导系统提示与父会话组合在共享前缀上字节一致，保留继承历史之上的提供方前缀缓存复用。
- **委托子会话，而非另造 agent。** 组合 subagent 包的工具函数（而非新建子会话管线）让深度记账、策略种子与 preset 加入只有一个归属；`completedTurnPrefix` 从 fork provider 移入 `dsh-subagent`，种子规则因此有唯一属主。

## Alternatives considered

- **对 `deriveMessages(parent)` 直接发一次性 LLM 调用**（OpenClaw 的非 Codex 路径）：拒绝，因为它剥离了工具面（答案无法读文件），而且任何会话日志之外的组合请求都会削弱[可重建请求](../architecture/2026-07-05-reconstructable-requests.md)。侧边子会话自身的持久日志让这场交流可回放。
- **subagent seam（`ctx.subagents.start`）**：随提案一起拒绝——侧边问题是用户驱动、客户端可见的，不应以面向模型的委托工具形式出现。
- **面向侧边子会话的只读 `tools/pre-execute` 拒绝门**：随提案的风险说明延后；该门落地之前顾问框架只是建议。

## Consequences

- 父会话日志只记录仅日志的 `command/run`/`command/done` 配对；`recordInput` 保持启用，问题文本因此恰有一份父侧持久记录。交流的任何内容都不进入父会话的模型请求或有序 surface。
- 处理器执行一整个子轮次，可能比发起分派的 UI 请求存活更久；被中止的分派会取消并销毁子会话，注册表把命令结算为错误，与进程内 subagent driver 的交接一致。
- 父会话日志被压缩后，侧边子会话继承的是压缩视图；子会话的组合包含 `/btw` 本身，但人类命令经由 UI 适配器寻址 agent，没有 UI 适配器就不存在递归路径。
- 答案通过随附的通用命令卡片渲染；专属的可关闭侧边结果卡片属于客户端工作，随第一个绑定的 UI 落地，与提案范围一致。

## Verification

`packages/interaction/command-btw/tests` 的包套件：带脚本适配器的真实 `AgentLoop` 组合覆盖 fork+血缘+种子相等性、顾问先于问题的请求顺序、父日志隔离与后续轮次、无已完成轮次的父会话路径、空输入、error/max-tokens/blocked/空 complete 结算、飞行中中止及子会话销毁、创建交接中止竞态（与 subagent driver 套件相同的包装 `create` 技术）、过期创建种子之外的已记录路由继承（双适配器 + 手工追加 `change` 头），以及无路由父会话的失败轮次结算。Loader 引导的 `cordis.yml` 组合端到端执行 `/btw`。逐文件覆盖率 100%。没有 transcript 快照：没有任何随附快照示例组合命令适配器，与 `/goal`、`/feedback`、`/compact` 的先例一致；快照覆盖随第一个绑定的 UI 落地。
