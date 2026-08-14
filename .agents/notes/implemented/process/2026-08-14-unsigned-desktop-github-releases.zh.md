# Agent Note: 无签名桌面 GitHub Releases

Status: implemented

[English](2026-08-14-unsigned-desktop-github-releases.md) | 中文

## 问题

原生桌面产物必须在匹配的 macOS 与 Windows runner 上构建。临时工作流产物会过期，无法为安装桌面应用的用户提供持久、可按 commit 定位的下载与校验和集合。

仓库的包、Python、Landlock 与文档工作流按设计只执行验证。桌面二进制分发需要一处范围严格的发布权限，同时不能给这些工作流重新引入 registry 凭据、Pages 部署、签名 secret 或发布路径。

## 决策

[桌面工作流](../../../../.github/workflows/desktop.yml)负责原生构建、验证与发布。Pull request 与手动派发会使用 GitHub 标准托管的 `macos-14` 和 `windows-2025` runner 构建受支持的 macOS arm64 与 Windows x64 产物组，供临时检查。相关变更推送到 `master` 时，两项原生构建成功后会追加一个 release job。

构建 job 按 runner 操作系统、架构与 `pnpm-lock.yaml` 缓存 Electron runtime 和 electron-builder 工具下载。desktop 包禁用 electron-builder 的原生依赖 rebuild，因为 `node-pty` 已随包提供所需的 macOS arm64 与 Windows x64 prebuild，且 ASAR 策略已将其解包。包过滤器会排除 `node-pty/build`，防止 host 或更早的 Electron 构建遮蔽目标 prebuild。每个矩阵项都会设置 `ELECTRON_RUN_AS_NODE=1` 执行打包后的 Electron 二进制文件，通过 `app.asar` 加载 `node-pty`，并启动原生 shell，成功后才接受产物。已经压缩的安装程序与归档使用零级工作流产物压缩。

Master 推送流程会在并发组中使用完整 commit SHA，且不会被后续流程取消。Pull request 与手动流程仍按 ref 分组并取消陈旧工作，因此较晚的合并无法在原生构建启动后终止较早 commit 的 release。

Release job 只下载 macOS arm64 DMG/ZIP 与 Windows x64 NSIS/MSI 工作流产物，要求四个文件均存在且非空，并将其与 `SHA256SUMS` 一起发布。只有该 job 获得 `contents: write`；构建 job 与工作流默认权限仍为 `contents: read`。它通过 GitHub CLI 使用仓库 token，不接收签名、公证、registry 或其他发布凭据。

每个 release tag 都是 `desktop-v<desktop 包版本>-g<完整 commit SHA>`，因此 tag 不可变，且无需为每次合并提升版本或依赖可变的 `latest` tag，就能指明源码 commit。Release 标题为 `DeepSeek Harness Desktop v<version> (<commit 前 12 个字符>)`。包版本为预发布版本时创建 GitHub prerelease，稳定版本则创建普通 release。首次运行会在触发流程的 commit 上创建带自动生成 notes 的 draft，上传五个产物，并仅在全部上传成功后发布。重新运行会使用 `--clobber` 恢复未完成的 draft；已经发布的 release 保持不变，因此仓库强制 immutable releases 时也可兼容。

该桌面 GitHub Release 是[仅验证的 GitHub Actions](2026-08-14-validation-only-github-actions.md)的具名例外。dsh、vendored framework、Landlock Run、Python 与文档发布工作流仍只执行验证，并保留既有的禁止性保证。

## 考虑过的替代方案

**只通过手动派发发布。** 不予采纳，因为这会让默认分支缺少持续交付，并使操作方选择的 ref 成为常规桌面分发路径。

**移动一个 `latest` tag 并替换其产物。** 不予采纳，因为可变 tag 会丢失源码与二进制之间的精确关系，并使并发的 master 更新争用同一个 release。

**在该工作流中保留 Linux 与 macOS x64 验证。** 不予采纳，因为该 fork 只分发 Windows x64 与 macOS arm64；不支持的目标会占用 runner 容量，却不增加发布证据。

**使用第三方 release action 或添加签名。** 不予采纳，因为 GitHub CLI 已提供所需的 release 操作，而签名与公证需要另一套身份、secret 和信任策略，本决策明确不创建这些内容。

## 后果

每次完成的相关 master 推送流程都会产出一个与单一源码 commit 绑定的持久 GitHub Release。用户会获得四个无签名安装程序或归档以及校验和；仍预计会出现平台信任警告。

应用不包含 updater，也不会使用 release 元数据。发布这一外部副作用只由受 guard 限制的 release job 持有；原生构建验证成功后，GitHub 可用性会成为发布依赖。

## 测试

`scripts/desktop-workflow.spec.ts` 钉住 master 并发行为、发布 guard、job 级写权限、受支持的发布子集、不可变命名、校验和生成、prerelease 分类、重新运行行为、下载缓存键、排除原生 rebuild 与陈旧 build、打包后的原生模块冒烟验证，以及不使用签名或 registry 凭据。每个原生矩阵项都会加载打包后的 `node-pty` prebuild、启动 shell，并在上传前校验自己的产物组，因此 release job 只能使用成功构建流程产生的产物。
