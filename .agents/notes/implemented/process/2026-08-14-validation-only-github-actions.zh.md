# Agent Note: 仅验证的 GitHub Actions

Status: implemented

[English](2026-08-14-validation-only-github-actions.md) | 中文

## 问题

仓库的 GitHub Actions 同时承担源码验证与 npm、PyPI、GitHub Pages 发布。虽然发布由单独的发布流程负责，这些 job 仍持有 registry 凭据，或具有写入能力的 OIDC 与 Pages 权限。保留两套发布权威会让生产路径的归属不明确，也会留下能够产生外部副作用的手动工作流。

包与文档验证仍属于本仓库。Pull request 需要证明各包族能够构建、打包、安装并通过元数据检查；文档变更需要证明投影和生产网站构建成功。

## 决策

GitHub Actions 对 dsh、vendored framework、Landlock Run、Python 和文档发布相关内容只执行验证。`.github/workflows/release.yml`、`release-vendor.yml`、`landlock-run-release.yml`、`python-release.yml` 和 `docs-pages.yml` 不包含发布输入、registry 凭据、发布 job、具有写入能力的 OIDC 或 Pages 权限，也不包含 Pages 部署 action。

这些工作流保留发布前的源码检查：npm 包族执行构建、打包并验证已安装的 tarball；Landlock 构建每个原生目标并验证组装后的包集合；Python 构建全部 wheel 包，测试受支持的 Python 版本，并检查精确文件名、大小、元数据和哈希；文档运行 `doc-sync`，其中包含生产网站构建。临时 GitHub 产物只作为验证证据，不构成发布渠道。

`scripts/publishing-workflow.spec.ts` 枚举五个工作流保留的 job 与必需验证命令，并拒绝 registry 凭据、npm 与 PyPI 发布命令以及 GitHub Pages 部署权限。普通 CI、桌面端、原生、sandbox 和 e2e 工作流仍是代码测试工作流。

此决策仅取代 [npm 发布序列](2026-08-10-npm-release-sequences.md)、[Python 发布工作流](2026-08-11-python-publication-workflow.md)和[仓库内 Landlock 发布](2026-08-06-in-repository-landlock-release.md)中有关 GitHub 发布归属与 job 的细节。这些说明仍负责包族边界、版本、产物验证和原生源码归属。

## 考虑过的替代方案

**删除五个工作流。** 这样会移除外部副作用，但也会移除包、原生二进制、wheel 包和文档验证，使单独的发布流程运行前无法发现源码与包内容漂移。

**通过 `if: false` 或禁用输入保留发布 job。** 工作流仍会保留生产凭据、写权限、environment 和发布命令，继续成为第二套发布权威。删除这些 job 后，禁止发布成为可由测试验证的结构性保证。

**保留 GitHub Pages 部署，因为它只发布文档。** Pages 部署仍是外部生产副作用，与包发布一样违反单一归属规则。文档构建保留，部署 job 删除。

## 后果

仓库 GitHub Actions 无法发布 npm 包或 Python wheel 包，也无法部署文档站点。单独的发布流程必须使用仓库版本和已验证输出，不能依赖 GitHub 发布 job。

Pull request 与手动验证会保留临时产物供检查。向这些工作流添加发布 job、凭据、写权限或部署 action，需要明确推翻此决策并更新工作流策略测试。
