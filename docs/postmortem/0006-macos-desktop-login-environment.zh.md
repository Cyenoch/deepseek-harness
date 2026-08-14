# 事故复盘（postmortem） 0006：macOS GUI 启动使 Agent Bash 找不到登录 shell 工具

[English](0006-macos-desktop-login-environment.md) | 中文

Status: resolved

## 执行摘要

macOS 桌面 Agent 可以运行 Bash，但应用从 Finder 或 Dock 启动时，通过 Homebrew、pnpm 或 shell 版本管理器安装的命令会返回 `command not found`。Electron 继承了图形会话的精简环境，subprocess 服务又正确转发了这份不完整的 PATH。测试与本地开发都从终端启动 Electron，因此携带了缺失目录并掩盖了该缺陷。Desktop main 现在会在组合 Host 前导入登录 shell 中缺失的导出变量，同时保留显式启动值和 PATH 优先级；真实 Electron 测试会以精简 PATH 启动并验证恢复结果。

## 概述

本地 subprocess provider 从 `process.env` 构建子进程环境，移除凭据和陈旧的 `DSH_*` 值，但有意保留 PATH 与其他普通启动变量。因此，Bash 相对于持有它的 Electron 进程表现正确。

macOS 不会通过用户的终端登录 shell 启动 Finder 和 Dock 应用。Desktop 进程会收到 `/usr/bin`、`/bin` 等系统目录，但不会收到 shell 启动文件建立的目录。Agent 调用的 Bash 继承了这份精简 PATH，因此绝对路径 `/opt/homebrew/bin/node` 能执行，而普通的 `node` 命令不能。

## 影响

macOS 桌面应用中的 Agent Bash 调用找不到常见开发工具，即使同一命令能在用户终端中工作。受影响的命令会以退出码 127 失败。文件系统搜索在另一项 ASAR 路径修复后使用打包的 ripgrep 绝对路径，因此仍可工作，这使环境问题在诊断期间看起来像单一工具故障。

缺失 shell 变量不会削弱 sandbox。该故障只会减少可用命令；恢复环境后，subprocess 凭据清除仍然生效。

## 时间线

- Desktop 开发流程与 Electron e2e 从终端或 CI 进程继承环境。
- 打包后的应用可以从 Finder 启动，而打包态冒烟测试使用测试 runner 的 PATH 执行 Agent Bash。
- 真实 Agent 探针显示 `/opt/homebrew/bin/node` 存在，但裸 `node` 以退出码 127 失败。
- 对比 desktop 进程与正常登录 shell 后发现，GUI 会话 PATH 缺少包管理器目录。
- Desktop main 开始在创建 Host 环境快照前恢复登录 shell 导出的变量，Electron e2e 同时加入精简 PATH 启动用例。

## 根因

Desktop launcher 把 Electron 继承环境当成等同于终端启动环境。开发者从 shell 运行 Electron 时，这一等价关系成立；macOS LaunchServices 从 Finder 或 Dock 启动应用时并不成立。

测试矩阵重复了这一假设。单元测试与包测试正确验证了 subprocess 继承，而源码 Electron e2e 与打包态运行时冒烟测试都由已经具备开发者 PATH 的命令启动。没有测试代表只含系统 PATH 条目的 macOS 图形启动。

## 已添加的防护措施

- 在 macOS 上组合 Host 前，desktop main 会以登录且交互模式运行一次配置的绝对登录 shell，并通过带上限、带 marker 的 NUL 输出读取其导出环境。
- Electron 已有变量保持更高优先级。PATH 先保留既有条目，只追加登录 shell 中缺失的目录；易变的 shell 内部状态不会导入。
- Shell 启动有五秒超时与一兆字节输出上限。执行失败或输出不完整时，应用会发出警告并保留原有继承环境。
- [`launch-environment.spec.ts`](../../apps/desktop/tests/launch-environment.spec.ts)钉住解析、合并优先级、平台范围和失败回退。
- [`desktop-profile.e2e.ts`](../../apps/web/tests/desktop-profile.e2e.ts)以只有系统目录的 PATH 和临时登录 shell 导出值启动 macOS Electron，然后验证 main 已恢复两者，再继续执行正常应用生命周期。

## 教训

- Desktop Agent 的 shell 环境属于 launcher 职责。Subprocess provider 无法重建其父进程从未收到的变量。
- 从终端启动的 Electron 测试不能代表 Finder 或 Dock 启动；macOS desktop 覆盖需要显式的精简环境用例。
- 导入登录环境必须保留直接启动意图。替换 PATH 虽能修复 Finder 启动，却会悄然改变终端与 CI 中的命令优先级。
- 打包后的绝对可执行文件与面向用户的 shell 命令需要分别覆盖：前者能够工作时，后者仍可能在 PATH 查找上失败。
