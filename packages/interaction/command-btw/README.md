# @deepseek-ai/dsh-command-btw

English | [中文](README.zh.md)

Human-facing `/btw <question>`: one side question asked against the session's context without disturbing the main conversation. The handler forks the receiving agent's completed-turn prefix into a fresh child agent, frames it as a read-only advisor, asks the question in the child's single turn, and returns the child's final answer as the command's direct UI text. The [BTW side questions Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-btw-side-questions.md) owns the mechanism and product decisions.

## Mechanics

The side child is created through `ctx.agents.create` with [`dsh-subagent`](../../subagent/subagent/README.md)'s shared child composition: the parent's balanced completed-turn prefix as its seed (an in-flight turn is excluded; a parent with no completed turn yields a fresh child), `parentSession`/`seedLength`/`origin: 'subagent'`/`delegationDepth` lineage metadata, the parent's session policy overrides with the approval policy pinned to `never`, and the parent's composition joined unchanged — same preset, same tool surface, plus the fixed delegation-scope statement, so the child's request prefix stays byte-compatible with the provider cache over inherited history.

The child runs on the route the parent's requests actually used: the parent session's last logged `request/header` config wins, because a mid-session model switch updates that log while the parent's creation-time `AgentOptions` seed goes stale; a parent that has made no request yet falls back to its creation-time options.

The advisor framing is one plugin-sourced context message (`source: { kind: 'plugin', plugin: 'command-btw' }`) injected ahead of the question in the child's own history; the question itself is an ordinary user message. After the child's turn settles, the child's final assistant output becomes the command result and the child agent is disposed. A partial answer survives cancellation of the child's stream; a cancelled, failed, truncated, or refused turn settles as a command error naming what happened.

The parent is untouched: its log gains only the generic log-only `command/run`/`command/done` pairing, `recordInput` stays enabled so `command/run` carries the question verbatim, and its model history, ordered surface, and any in-flight turn are unchanged. Nothing about the exchange enters the parent's model requests.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `advisor` | `string` | required | Advisor framing injected as the side child's first context message. Missing, blank, or unknown fields fail at plugin load. |

## Composition

The producer injects only `commands`; the side child needs the agent factory (`dsh-agent-loop`) composed at runtime. A custom app mounts the command registry plus this plugin:

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

The shipped `dsh` base bundle mounts this plugin with the product advisor text; surfaces without `ctx.commands` cannot invoke it.

## Model Experience

### Side-child advisor context

#### What the model sees

The side child sees the deployment's exact `advisor` text as one user-role context message before the side question, on top of the inherited completed-turn prefix. The parent model never sees the question, the framing, or the answer.

##### Configuration example

```markdown
You are answering a side question the user asked through /btw, separate from the main task in this session's inherited history. Answer only the side question.
```

#### Token effect

One side question costs one child request: the inherited prefix plus one advisor message plus the question. Parent requests gain nothing.

#### KV Cache effect

The child's leading system prompt is byte-identical to its parent's composition over the shared prefix, so inherited-history cache reuse is preserved; the runtime-context additions append after that prefix. Parent requests are untouched.

### Human command

#### What the model sees

`/btw`, the question, and the answer stay outside the parent's model history: they exist only in the log-only `command/run` (args) and `command/done` (result text) pairing and in the child's own session.

#### Token effect

Zero direct tokens for the parent. The child request's tokens are the exchange's whole cost.

#### KV Cache effect

Independent: the exchange adds no tokens to any parent request, so no parent cache reuse is affected.

## Known Limitations and Deferred Work

- **Advisor framing is advisory** — the side child keeps the parent's full tool surface; a `tools/pre-execute` read-only deny gate for side children remains open composition work.
- **No merge-back** — the side answer never reaches the parent's model context; an explicit future merge gesture would own that, following the deferred alternative in the [side sessions proposal](../../../.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md).
- **Generic presentation** — the answer renders through the shipped generic command card; a dedicated dismissible side-result card or panel belongs to a client UI.
