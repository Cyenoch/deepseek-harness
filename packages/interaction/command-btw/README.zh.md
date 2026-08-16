# @deepseek-ai/dsh-command-btw

[English](README.md) | 中文

面向用户的 `/btw <question>`：基于会话上下文提出一次性侧边问题，不干扰主对话。处理器把接收 agent（智能体）已完成轮次的前缀 fork 成一个全新的子 agent，将其框定为只读顾问，在子会话的单轮中提出问题，并把子的最终回答作为命令的直接 UI 文本返回。[BTW 侧边问题 Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-btw-side-questions.md) 拥有机制与产品决策。

## 机制

侧边子会话通过 `ctx.agents.create` 创建，并复用 [`dsh-subagent`](../../subagent/subagent/README.md) 的共享子组合：以父会话平衡的已完成轮次前缀作为种子（进行中的轮次被排除；没有任何已完成轮次的父会话产生一个全新的子会话），带 `parentSession`/`seedLength`/`origin: 'subagent'`/`delegationDepth` 血缘元数据、父会话的策略覆盖（审批策略固定为 `never`），并原样加入父会话的组合——同一 preset、同一工具面，外加固定的委托范围声明，因此子请求的前缀与继承历史之上的提供方缓存保持字节兼容。

子会话运行在父会话请求实际使用的路由上：父会话日志中最后一条 `request/header` 的 config 优先，因为会话中途切换模型只更新该日志，而父会话创建时的 `AgentOptions` 种子会过期；尚未发出任何请求的父会话回落到其创建时的 options。

顾问框架是一条插件来源的上下文消息（`source: { kind: 'plugin', plugin: 'command-btw' }`），注入在子会话自身历史中、问题之前；问题本身是普通的用户消息。子轮次结算后，子的最终 assistant 输出成为命令结果，子 agent 随即销毁。子流被取消时部分回答仍然保留；被取消、失败、截断或拒绝的轮次以点明原因的命令错误结算。

父会话不受影响：其日志只新增通用的仅日志 `command/run`/`command/done` 配对，`recordInput` 保持启用使 `command/run` 逐字携带问题，其模型历史、有序 surface 与任何进行中的轮次都不改变。这场交流的任何内容都不会进入父会话的模型请求。

## 配置

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `advisor` | `string` | 必填 | 作为侧边子会话首条上下文消息注入的顾问框架。缺失、空白或未知字段在插件加载时失败。 |

## 组合

生产方只注入 `commands`；侧边子会话在运行时需要 agent factory（`dsh-agent-loop`）被组合。自定义应用挂载命令注册表与本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-btw
  name: '@deepseek-ai/dsh-command-btw'
  config:
    advisor: |
      Answer only the side question; treat the inherited conversation as
      background context and do not continue the main task.
```

随产品交付的 `dsh` base bundle 以产品默认顾问文本挂载本插件；没有 `ctx.commands` 的界面无法调用它。

## Model Experience

### 侧边子会话的顾问上下文

#### 模型看到什么

侧边子会话在侧边问题之前看到部署方精确的 `advisor` 文本，作为一条用户角色的上下文消息，叠加在继承的已完成轮次前缀之上。父会话模型永远看不到问题、框架或回答。

##### 配置示例

```markdown
You are answering a side question the user asked through /btw, separate from the main task in this session's inherited history. Answer only the side question.
```

#### Token 效应

一次侧边问题花费一个子请求：继承前缀 + 一条顾问消息 + 问题。父会话请求不增加任何内容。

#### KV Cache 效应

子会话的前导系统提示与父会话组合在共享前缀上字节一致，继承历史的缓存复用得以保留；运行时上下文的追加位于该前缀之后。父会话请求不受影响。

### 用户命令

#### 模型看到什么

`/btw`、问题与回答都留在父会话模型历史之外：只存在于仅日志的 `command/run`（args）与 `command/done`（结果文本）配对以及子会话自身日志中。

#### Token 效应

对父会话零直接 token。子请求的 token 就是整场交流的全部成本。

#### KV Cache 效应

相互独立：交流不给任何父会话请求增加 token，因此不影响任何父会话缓存复用。

## Known Limitations and Deferred Work

- **顾问框架只是建议** —— 侧边子会话保留父会话的完整工具面；面向侧边子会话的 `tools/pre-execute` 只读拒绝门仍是待完成的组合工作。
- **无合并回写** —— 侧边回答永远不会进入父会话的模型上下文；未来的显式合并手势将拥有该能力，见[侧会话提案](../../../.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md)中延后的备选方案。
- **通用呈现** —— 回答通过随附的通用命令卡片渲染；专属的可关闭侧边结果卡片或面板属于客户端 UI 的工作。
