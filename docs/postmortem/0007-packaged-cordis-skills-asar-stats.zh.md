# 事故复盘（postmortem） 0007：打包后的 Cordis Agent 丢失 ASAR 内的 skill

[English](0007-packaged-cordis-skills-asar-stats.md) | 中文

Status: resolved

## 执行摘要

打包后的 desktop Cordis Agent 展示了一套依赖 `cordis-plugin-development` 的工作流，但加载该 skill 时返回“unknown or no longer available”。两个 skill 文件都存在于 `app.asar` 内，并且可以直接读取。Electron 对 bigint stat 请求返回了普通数值型 `Stats`，`dsh-fs-local` 在发现目录时把数值 mode 与 bigint 掩码混用。源码测试使用物理文件系统，打包态冒烟又只创建 Standard Agent 并加载 workspace skill，因此两者都没有代表 ASAR skill 根目录。文件系统元数据规范化现在依据实际返回类型，打包态冒烟也会通过真实 Agent 工具加载两项 Cordis 创作 skill。

## 概述

随附的 Cordis preset 把 `cordis-plugin-development` 与 `editing-cordis-compositions` 放在 composition 旁的 `config/agent-presets/cordis/skills` 下。其 scoped `dsh-skill-filesystem` provider 通过 `ctx.fs` 发现该自定义根目录，再由 `dsh-tool-skill` 加载选中的定义。

在源码 checkout 中，该根目录是普通目录，Node 会遵守 `stat(path, { bigint: true })`。在打包后的 desktop 应用中，同一路径进入 Electron 的虚拟 `app.asar` 文件系统。Electron 可以列出并读取文件，但其 ASAR stat 实现即使收到 bigint overload，也会返回普通 number 字段的 `Stats`。

## 影响

打包后的 desktop 应用中，Cordis Agent 会话无法加载随附 preset 的任一创作 skill。系统提示仍要求模型以 `cordis-plugin-development` 调用 `skill`，因此即使安装内容包含该文件，故障看起来仍像 skill 缺失或已过期。

Standard Agent 的 workspace skill 与普通项目文件仍然可用，因为它们位于物理文件系统。Cordis preset 的其他工具仍可挂载，因此可见故障集中在 skill 加载。

## 时间线

- Cordis preset 随附两项创作 skill，源码 composition 覆盖也确认了 scoped skill provider。
- Desktop 产物冒烟会启动真实打包 profile，但只创建 Standard Agent 并加载临时 workspace skill。
- 打包后的 Cordis Agent 报告 `skill "cordis-plugin-development" is unknown or no longer available`。
- ASAR 检查确认两个文件都存在，Electron 的直接 `readdir` 与 `readFile` 调用也成功。
- 捕获 provider 被跳过时的警告后，发现 `ctx.fs.listDir` 内出现 `Cannot mix BigInt and other types`。
- `dsh-fs-local` 开始规范化普通与 bigint stat 结果，打包态冒烟也加入 Cordis Agent，并加载两项已安装 skill。

## 根因

`dsh-fs-local` 信任 Node 为 `stat(path, { bigint: true })` 声明的 TypeScript overload，并立即计算 `info.mode & 0o777n`。Electron 的 ASAR 实现接受该调用，却返回 number 字段。该位运算因此在目录发现返回候选项之前抛错。

Skill registry 按设计会包含失败的 provider，把本次观察标记为不完整，并记录 provider 错误，使无关 provider 仍可使用。请求的 skill 没有其他候选项，所以面向模型的工具给出普通的 unknown-skill 诊断。如果不检查运行时警告，最终错误会掩盖文件系统元数据不匹配。

此前每项检查都运行在不同环境。文件系统单元测试使用原生 Node，而它会遵守 bigint overload。Preset e2e 使用物理磁盘上的源码配置目录。产物检查只能证明文件已包含，不能证明 provider 能够遍历。打包态运行时冒烟加载的是临时物理目录下的 workspace skill，从未挂载 Cordis preset。

## 已添加的防护措施

- `normalizeStatIdentity` 根据实际字段类型选择 bigint 纳秒元数据或普通毫秒元数据，并使用匹配的数值 mode 掩码。
- [`fsio.spec.ts`](../../packages/fs/fs-local/tests/fsio.spec.ts)把真实的普通 `Stats` 与 `BigIntStats` 都传入该规范化函数。
- [`web-agent-presets.e2e.ts`](../../apps/cli/tests/web-agent-presets.e2e.ts)要求 Cordis composition 发现两项创作 skill，并加载完整的 plugin-development 正文。
- [`smoke-desktop-native-module.ts`](../../scripts/smoke-desktop-native-module.ts)在打包后的 Electron runtime 内创建 Cordis Agent，检查两个 ASAR skill 名称，并通过真实 `skill` 工具执行 `cordis-plugin-development`。

## 教训

- Node 兼容虚拟文件系统可能接受一个 overload，却不返回 Node 类型承诺的原生字段表示；文件系统 adapter 必须规范化实际观察到的 runtime 值。
- 文件存在性检查不能证明服务可以通过生产抽象遍历并解析打包资源。
- 打包态 Agent 冒烟必须覆盖 preset 专属资源，不能只覆盖与默认 preset 共享的工具和文件。
