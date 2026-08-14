# Agent Note: Validation-only GitHub Actions

Status: implemented

English | [中文](2026-08-14-validation-only-github-actions.zh.md)

## Problem

The repository's GitHub Actions combined source validation with npm, PyPI, and GitHub Pages publication. Those jobs carried registry credentials or write-capable OIDC and Pages permissions even though publication is owned by a separate release process. Keeping two release authorities makes the production path ambiguous and leaves a manual workflow capable of external side effects.

Package and documentation validation still belongs in this repository. Pull requests need to prove that package families build, pack, install, and satisfy metadata checks; documentation changes need to prove that projection and the production website build succeed.

## Decision

GitHub Actions are validation-only for the dsh, vendored framework, Landlock Run, Python, and documentation release surfaces. `.github/workflows/release.yml`, `release-vendor.yml`, `landlock-run-release.yml`, `python-release.yml`, and `docs-pages.yml` contain no publication input, registry credential, publication job, write-capable OIDC or Pages permission, or Pages deployment action.

The workflows retain the source checks that precede release: npm families build, pack, and verify installed tarballs; Landlock builds each native target and verifies the assembled package set; Python builds all wheels, tests supported Python versions, checks exact filenames, size, metadata, and hashes; documentation runs `doc-sync`, including the production website build. Temporary GitHub artifacts remain validation evidence, not a publication channel.

`scripts/publishing-workflow.spec.ts` enumerates the retained jobs and required validation commands for all five workflows and rejects registry credentials, npm and PyPI publication commands, and GitHub Pages deployment authority. The ordinary CI, native, sandbox, and e2e workflows remain code-test workflows. The [unsigned desktop GitHub Release](2026-08-14-unsigned-desktop-github-releases.md) is the named binary-publication exception and is limited to desktop installers.

This decision supersedes only the GitHub publication ownership and job details in the [npm release sequences](2026-08-10-npm-release-sequences.md), [Python publication workflow](2026-08-11-python-publication-workflow.md), and [in-repository Landlock release](2026-08-06-in-repository-landlock-release.md). Those notes continue to own package-family boundaries, versioning, artifact validation, and native source ownership.

## Alternatives considered

**Delete the five workflows.** This removes the external side effects but also removes package, native, wheel, and documentation validation that catches source and package drift before the separate release process runs.

**Keep publication jobs behind `if: false` or a disabled input.** The workflow would retain production credentials, write permissions, environments, and publication commands as a second release authority. Removing those jobs makes the negative guarantee structural and testable.

**Keep GitHub Pages deployment because it publishes only documentation.** Pages deployment is still an external production side effect and conflicts with the same single-owner rule as package publication. The documentation build remains without the deployment job.

## Consequences

Repository GitHub Actions cannot publish npm packages or Python wheels and cannot deploy the documentation site. The separate release process must consume repository versions and validated outputs without relying on a GitHub publication job.

Pull requests and manual validation retain transient artifacts for inspection. Adding a publication job, credential, write permission, or deployment action to the five listed validation workflows requires an explicit reversal of this decision and an update to the workflow-policy test.
