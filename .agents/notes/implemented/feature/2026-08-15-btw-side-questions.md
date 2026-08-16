# Agent Note: BTW side questions over a forked ephemeral child

Status: implemented

English | [中文](2026-08-15-btw-side-questions.zh.md)

## Problem

A user wants to ask one quick question about the live session — "what changed?", "why did this fail?" — without turning it into conversation history or steering the in-flight task. Peer products set the shape: OpenClaw's `/btw` snapshots session context into a one-shot side query whose answer is displayed but never persisted to the main transcript; Codex `/side` forks an ephemeral side thread with guardrails against continuing parent work. Existing harness primitives did not expose that product surface: a session-store fork is unattached, and fork subagents are model-driven runs that collapse into one tool result. The earlier [interactive side sessions proposal](../../proposed/feature/2026-07-08-interactive-side-sessions.md) designed the client-independent mechanics; this note records what shipped.

## Decision

`/btw <question>` ([`dsh-command-btw`](../../../../packages/interaction/command-btw/README.md), mounted by the base bundle) forks the receiving agent's balanced completed-turn prefix into a fresh child through `ctx.agents.create`, reusing [`dsh-subagent`](../../implemented/feature/2026-06-21-subagent-capability-seam.md)'s shared child composition: `childSessionMeta` lineage (`parentSession`, `seedLength`, `origin: 'subagent'`, `delegationDepth`), the delegated policy seed (approval pinned `never`), and `applyChildComposition` joining the parent's preset unchanged. The child's route comes from the parent session's last logged `request/header` config, falling back to the parent's creation-time `AgentOptions`: a mid-session model switch (the web model picker) updates the logged header while the creation-time seed goes stale, so seeding from `AgentOptions` alone sent children to whatever the global default was when the parent was created — observed live as every `/btw` child routing to a broken default provider while the parent's own requests ran on its switched route. One deployment-configured advisor context message (`source: { kind: 'plugin', plugin: 'command-btw' }`) is injected ahead of the question; the question is the child's single follow-up turn; the child's final assistant output becomes the `command/done` text and the child agent is disposed.

Deviations from the proposal, with reasons:

- **No merge-back.** The proposal's length-capped handback into the parent stays deferred: both product references are strictly ephemeral ("no future context pollution"), and the user ask was display-only. Merge-back remains the proposal's open extension point.
- **`origin: 'subagent'`, not an ordinary fork.** Stamping through `childSessionMeta` keeps one child-lineage vocabulary and hides the ephemeral child from the ordinary sidebar; session switching and dedicated presentation belong to a future client UI, as the proposal already scoped.
- **Advisor framing as an injected message, not a system-prompt change.** Follows the proposal's cache rationale: the child's leading system prompt stays byte-identical to its parent's composition over the shared prefix, preserving provider prefix-cache reuse over inherited history.
- **Delegated child, not a bespoke agent.** Composing the subagent package's utilities (rather than new child plumbing) keeps depth accounting, policy seeding, and preset joining in one home; `completedTurnPrefix` moved from the fork provider to `dsh-subagent` so the seed rule has a single owner.

## Alternatives considered

- **A direct one-shot LLM call over `deriveMessages(parent)`** (OpenClaw's non-Codex path): rejected because it strips the tool surface (the answer could not read files), and a composed request outside any session log would weaken [reconstructable requests](../architecture/2026-07-05-reconstructable-requests.md). The side child's own durable log keeps the exchange replayable.
- **The subagent seam (`ctx.subagents.start`)**: rejected with the proposal — side questions are user-driven, client-visible, and must not surface as a model-facing delegation tool.
- **A read-only `tools/pre-execute` deny gate for side children**: deferred with the proposal's own risk note; the advisor framing is advisory until that gate lands.

## Consequences

- The parent log records only the log-only `command/run`/`command/done` pairing; `recordInput` stays enabled so the question text has exactly one parent-side durable record. Nothing from the exchange enters the parent's model requests or ordered surface.
- The handler performs one whole child turn and can outlive the dispatching UI request; an aborted dispatch cancels and disposes the child while the registry settles the command as an error, mirroring the in-process subagent driver's handoff.
- The side child inherits a compacted view when the parent's log is compacted; the child's composition includes `/btw` itself, but human commands address an agent through a UI adapter, so no recursion path exists without one.
- The answer renders through the shipped generic command card; a dedicated dismissible side-result card is client work that lands with the first bound UI, per the proposal's scope.

## Verification

Package suites in `packages/interaction/command-btw/tests`: real-`AgentLoop` composition with a scripted adapter covers the fork+lineage+seed equality, advisor-before-question request order, parent-log isolation and continued turns, the fresh-parent path, empty input, error/max-tokens/blocked/empty-complete settlements, mid-flight abort with child disposal, the creation-handoff abort race (the same wrapped-create technique the subagent driver suite uses), logged-route inheritance past a stale creation-time seed (two adapters, hand-appended `change` header), and the routeless parent's failed-turn settlement. A Loader-booted `cordis.yml` composition executes `/btw` end to end. Per-file coverage is 100%. No transcript snapshot exists: no shipped snapshot example composes a command adapter, matching the `/goal`, `/feedback`, and `/compact` precedent; snapshot coverage lands with the first bound UI.
