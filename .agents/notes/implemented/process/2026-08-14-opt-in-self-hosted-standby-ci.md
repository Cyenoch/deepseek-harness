# Agent Note: Opt-in self-hosted standby CI

Status: implemented

English | [中文](2026-08-14-opt-in-self-hosted-standby-ci.zh.md)

## Problem

The [serial reference](2026-07-21-serial-cross-platform-ci-reference.md), [larger hosted runners](2026-07-22-evidence-based-larger-hosted-runners.md), and [failover runbook](2026-07-26-ci-failover-runbook.md) treat `serial-linux-selfhosted` and `serial-windows` as master-push hot-standby drills: they request the in-house `vm-backup` and `dsh-win-ci` pools and keep a push run alive so a long unsharded aggregate can finish. This repository does not provision those pools. Unconditional drills therefore queue on missing labels, and a push-only `cancel-in-progress` exemption leaves superseded master runs uncancelled even when no drill is running.

The [failover runbook](2026-07-26-ci-failover-runbook.md) still needs those jobs when a repository does provision both pools: a green standby is the evidence a responder checks before flipping `DSH_CI_FAILOVER_LINUX` or `DSH_CI_FAILOVER_WINDOWS`. Removing the jobs would delete that rehearsal rather than stop this fork from requesting runners it does not have.

## Decision

Self-hosted standby drills are opt-in. `serial-linux-selfhosted` (`serial / linux (self-hosted standby)` on `vm-backup`) and `serial-windows` (`serial / windows (self-hosted standby)` on `dsh-win-ci`) run only when the event is a push to `master` and the repository variable `DSH_ENABLE_SELFHOSTED_STANDBY` equals `true`. Unset or any other value skips both jobs; neither job requests a self-hosted runner.

Workflow concurrency is `${{ vars.DSH_ENABLE_SELFHOSTED_STANDBY != 'true' || github.event_name != 'push' }}`. The default therefore cancels superseded CI runs, including master pushes. Explicit `true` restores the upstream exemption: a master push does not cancel the previous push, so an opted-in drill can finish, while pull requests and manual benchmarks still cancel stale runs.

`DSH_CI_FAILOVER_LINUX` and `DSH_CI_FAILOVER_WINDOWS` are unchanged. They still retarget the required Linux workers, the `all checks passed` verdict, and the independent native Windows job on pull requests. This note does not move those switches, change those pools, or delete failover support.

This decision partially supersedes the master-push-always-runs-standby default in the [serial reference](2026-07-21-serial-cross-platform-ci-reference.md), [larger hosted runners](2026-07-22-evidence-based-larger-hosted-runners.md), and [failover runbook](2026-07-26-ci-failover-runbook.md). Those notes still own the serial-aggregate shape, the hosted-runner evidence, and the per-platform failover switches.

## Alternatives considered

**Delete both standby jobs.** This stops the fork from requesting missing runners, but it also deletes the upstream failover rehearsal. A repository that later provisions `vm-backup` and `dsh-win-ci` would have to rewrite `ci.yml` to recover the drills and the evidence the runbook tells a responder to check.

**Leave the drills unconditional.** Every master push would request runners this fork does not have, and the push cancellation exemption would keep superseded master runs alive even though no drill can run. The default must never request those labels.

**Keep the jobs behind `if: false` and leave the push cancellation exemption.** The jobs would not request runners, but every master push would still refuse to cancel the previous one. `wine-apt-cache` and any later push-reachable job would then accumulate uncancelled runs for no readiness evidence.

**Move the drills into a separate workflow.** Cancellation is decided for the whole `CI-<ref>` run. A second workflow would not share that group with the runner benchmarks that must keep cancelling, and it would split a gate the workflow-policy test already pins in `ci.yml`.

## Consequences

Ordinary fork CI never requests a self-hosted standby runner. Pull-request failover still works through the existing variables. A repository that provisions both upstream pools restores upstream drill behavior by setting `DSH_ENABLE_SELFHOSTED_STANDBY` to `true`.

The cost is that standby evidence is absent until someone opts in. A responder who needs a green `serial / linux (self-hosted standby)` or `serial / windows (self-hosted standby)` run must set the variable and wait for an opted-in master push to finish before treating those lanes as current.

## Testing

`scripts/ci-workflow.spec.ts` pins both standby job `if` conditions to `github.event_name == 'push' && github.ref == 'refs/heads/master' && vars.DSH_ENABLE_SELFHOSTED_STANDBY == 'true'`, pins `cancel-in-progress` to `${{ vars.DSH_ENABLE_SELFHOSTED_STANDBY != 'true' || github.event_name != 'push' }}`, and keeps the push-reachable job set as `serial-linux-selfhosted`, `serial-windows`, and `wine-apt-cache`.
