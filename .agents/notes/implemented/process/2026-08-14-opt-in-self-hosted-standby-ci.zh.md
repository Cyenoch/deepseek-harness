# Agent Note: 按需启用的自托管热备 CI

Status: implemented

[English](2026-08-14-opt-in-self-hosted-standby-ci.md) | 中文

## 问题

[串行参考流程](2026-07-21-serial-cross-platform-ci-reference.md)、[大型托管运行器](2026-07-22-evidence-based-larger-hosted-runners.md)和[故障切换手册](2026-07-26-ci-failover-runbook.md)把 `serial-linux-selfhosted` 与 `serial-windows` 当作 master 推送上的热备演练：它们会请求公司自有的 `vm-backup` 与 `dsh-win-ci` 池，并让一次 push 运行保持存活，以便耗时更长的未分片聚合流程能够跑完。本仓库并不提供这些池。无条件演练因此会在缺失的标签上排队；仅按 push 豁免 `cancel-in-progress` 时，即使没有任何演练在运行，被取代的 master 运行也不会取消。

当某个仓库确实同时提供这两个池时，[故障切换手册](2026-07-26-ci-failover-runbook.md)仍然需要这些作业：响应者在扳动 `DSH_CI_FAILOVER_LINUX` 或 `DSH_CI_FAILOVER_WINDOWS` 之前，检查的就是绿色热备。删除这些作业会一并删掉那套演练，而不是阻止本 fork 去请求它并不拥有的运行器。

## 决策

自托管热备演练按需启用。`serial-linux-selfhosted`（`vm-backup` 上的 `serial / linux (self-hosted standby)`）与 `serial-windows`（`dsh-win-ci` 上的 `serial / windows (self-hosted standby)`）仅在事件是向 `master` 的 push、且仓库变量 `DSH_ENABLE_SELFHOSTED_STANDBY` 等于 `true` 时运行。变量未设置或为其他值时，两个作业均跳过；它们都不会请求自托管运行器。

工作流并发条件为 `${{ vars.DSH_ENABLE_SELFHOSTED_STANDBY != 'true' || github.event_name != 'push' }}`。因此默认会取消被取代的 CI 运行，包括 master 推送。显式设为 `true` 则恢复上游豁免：一次 master 推送不会取消上一次 push，使按需启用的演练能够跑完，而拉取请求和手动基准测试仍会取消陈旧运行。

`DSH_CI_FAILOVER_LINUX` 与 `DSH_CI_FAILOVER_WINDOWS` 保持不变。它们仍然在拉取请求上重定向必需的 Linux 工作作业、`all checks passed` 判定作业，以及独立的原生 Windows 作业。本说明不移动这些开关、不改这些池，也不删除故障切换支持。

此决策部分取代[串行参考流程](2026-07-21-serial-cross-platform-ci-reference.md)、[大型托管运行器](2026-07-22-evidence-based-larger-hosted-runners.md)和[故障切换手册](2026-07-26-ci-failover-runbook.md)中“每次 master 推送都运行热备”的默认。这些说明仍负责串行聚合形态、托管运行器证据，以及按平台拆分的故障切换开关。

## 考虑过的替代方案

**删除两个热备作业。** 这样本 fork 不会再请求缺失的运行器，但也会删掉上游的故障切换演练。之后若有仓库提供 `vm-backup` 与 `dsh-win-ci`，必须改写 `ci.yml` 才能恢复演练，以及手册要求响应者查看的那份证据。

**让演练保持无条件运行。** 每次 master 推送都会请求本 fork 并不拥有的运行器；push 取消豁免也会让被取代的 master 运行继续存活，尽管演练根本跑不起来。默认绝不能请求这些标签。

**用 `if: false` 关掉作业，但保留 push 取消豁免。** 作业不会请求运行器，但每次 master 推送仍拒绝取消上一次运行。`wine-apt-cache` 以及之后任何 push 可达的作业都会因此堆积未取消的运行，却换不来就绪证据。

**把演练挪到单独的工作流。** 取消是针对整个 `CI-<ref>` 运行决定的。第二个工作流无法与必须继续取消的运行器基准测试共用该组，也会把工作流策略测试已经锁定在 `ci.yml` 中的门控拆开。

## 后果

本 fork 的常规 CI 不会请求自托管热备运行器。拉取请求故障切换仍通过现有变量生效。同时提供两个上游池的仓库，只要把 `DSH_ENABLE_SELFHOSTED_STANDBY` 设为 `true`，即可恢复上游演练行为。

代价是：在有人按需启用之前，热备证据不存在。需要绿色 `serial / linux (self-hosted standby)` 或 `serial / windows (self-hosted standby)` 运行的响应者，必须先设置该变量，并等到一次按需启用的 master 推送跑完，才能把这些通道当作当前证据。

## 测试

`scripts/ci-workflow.spec.ts` 把两个热备作业的 `if` 条件锁定为 `github.event_name == 'push' && github.ref == 'refs/heads/master' && vars.DSH_ENABLE_SELFHOSTED_STANDBY == 'true'`，把 `cancel-in-progress` 锁定为 `${{ vars.DSH_ENABLE_SELFHOSTED_STANDBY != 'true' || github.event_name != 'push' }}`，并把 push 可达作业集合保持为 `serial-linux-selfhosted`、`serial-windows` 和 `wine-apt-cache`。
