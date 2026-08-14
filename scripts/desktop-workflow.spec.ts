import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRecord, loadWorkflow, workflowEvent, workflowJob } from './workflow-spec.ts'

const REQUIRED_PATHS = [
  '.github/workflows/desktop.yml',
  'apps/cli/**',
  'apps/desktop/**',
  'apps/web/**',
  'packages/**',
  'native/**',
  'package.json',
  'scripts/smoke-desktop-native-module.ts',
  'scripts/verify-desktop-artifacts.ts',
  'scripts/verify-runtime-closure.ts',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig*.json',
] as const

const DESKTOP_LEGS = [
  {
    target: 'macos-arm64',
    runner: 'macos-14',
    'builder-args': '--mac dmg zip --arm64 --publish never',
  },
  {
    target: 'windows-x64',
    runner: 'windows-2025',
    'builder-args': '--win nsis msi --x64 --publish never',
  },
] as const

function jobSteps(job: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(job.steps)) throw new TypeError('job must define steps')
  return job.steps.filter(isRecord)
}

function matrixLegs(job: Record<string, unknown>): unknown[] {
  if (!isRecord(job.strategy) || !isRecord(job.strategy.matrix) || !Array.isArray(job.strategy.matrix.include)) {
    throw new TypeError('build job must define strategy.matrix.include')
  }
  return job.strategy.matrix.include
}

function namedStep(steps: Record<string, unknown>[], name: string): Record<string, unknown> {
  const step = steps.find(candidate => candidate.name === name)
  if (step === undefined) throw new TypeError(`workflow must define ${name}`)
  return step
}

function usesStep(steps: Record<string, unknown>[], prefix: string): Record<string, unknown> {
  const step = steps.find(candidate => typeof candidate.uses === 'string' && candidate.uses.startsWith(prefix))
  if (step === undefined) throw new TypeError(`workflow must define ${prefix}`)
  return step
}

function walk(value: unknown, visit: (value: unknown, path: string) => void, path = '$'): void {
  visit(value, path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => { walk(item, visit, `${path}[${String(index)}]`) })
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) walk(child, visit, `${path}.${key}`)
  }
}

describe('Electron desktop workflow', () => {
  const workflow = loadWorkflow('.github/workflows/desktop.yml')
  const build = workflowJob(workflow, 'build')
  const steps = jobSteps(build)

  it('runs for the desktop dependency graph on PRs, master, and manual dispatch', () => {
    const pullRequest = workflowEvent(workflow, 'pull_request')
    const push = workflowEvent(workflow, 'push')
    if (!isRecord(workflow.on)) throw new TypeError('desktop workflow must define on')
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    expect(pullRequest.paths).toEqual([...REQUIRED_PATHS])
    expect(push.paths).toEqual([...REQUIRED_PATHS])
    expect(push.branches).toEqual(['master'])
    expect(workflow.on.workflow_dispatch).toBeNull()
  })

  it('builds two supported native Electron targets without builder-side signing or publication', () => {
    expect(matrixLegs(build)).toEqual(DESKTOP_LEGS)
    expect(build['runs-on']).toBe('${{ matrix.runner }}')
    expect(build['timeout-minutes']).toBe(60)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.env).toMatchObject({
      PRIMARY_NODE_VERSION: '24',
      DSH_TELEMETRY_DISABLED: '1',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    })
  })

  it('installs immutably, builds the assembled app, packages, verifies, and uploads', () => {
    expect(usesStep(steps, 'actions/checkout@').with).toEqual({ 'persist-credentials': false })
    expect(usesStep(steps, 'pnpm/action-setup@').with).toEqual({ dest: '${{ runner.temp }}/setup-pnpm' })
    expect(usesStep(steps, 'actions/setup-node@').with).toEqual({
      'node-version': '${{ env.PRIMARY_NODE_VERSION }}',
      cache: 'pnpm',
    })
    expect(namedStep(steps, 'Configure electron-builder cache').run)
      .toBe('echo "ELECTRON_BUILDER_CACHE=${RUNNER_TEMP}/electron-builder-cache" >> "$GITHUB_ENV"')
    expect(namedStep(steps, 'Restore electron-builder downloads')).toMatchObject({
      uses: 'actions/cache@v4',
      with: {
        path: '${{ runner.temp }}/electron-builder-cache',
        key: "desktop-electron-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}",
      },
    })
    const manifest = JSON.parse(readFileSync(resolve('apps/desktop/package.json'), 'utf8')) as unknown
    if (!isRecord(manifest) || !isRecord(manifest.build)) throw new TypeError('desktop manifest must define build')
    expect(manifest.build.npmRebuild).toBe(false)
    expect(manifest.build.files).toContain('!**/node-pty/build{,/**}')
    expect(namedStep(steps, 'Install (immutable)').run).toBe('pnpm install --frozen-lockfile')
    expect(namedStep(steps, 'Verify desktop runtime closure').run)
      .toBe('pnpm exec tsx scripts/verify-runtime-closure.ts --manifest=apps/desktop/package.json')
    expect(namedStep(steps, 'Build Host, renderer, and Electron entries').run).toContain('pnpm run build')
    expect(namedStep(steps, 'Build Host, renderer, and Electron entries').run)
      .toContain('pnpm --dir apps/desktop run build:code')
    expect(namedStep(steps, 'Build unsigned Electron artifacts').run)
      .toBe('pnpm --dir apps/desktop exec electron-builder ${{ matrix.builder-args }}')
    expect(namedStep(steps, 'Verify artifact set').run)
      .toContain('scripts/verify-desktop-artifacts.ts')
    expect(namedStep(steps, 'Verify packaged Agent runtime').run)
      .toBe('pnpm exec tsx scripts/smoke-desktop-native-module.ts --target="$TARGET" apps/desktop/release')
    expect(usesStep(steps, 'actions/upload-artifact@').uses).toBe('actions/upload-artifact@v6')
    expect(usesStep(steps, 'actions/upload-artifact@').with).toEqual({
      name: 'dsh-desktop-${{ matrix.target }}',
      path: `${[
        'apps/desktop/release/*.dmg',
        'apps/desktop/release/*.zip',
        'apps/desktop/release/*.exe',
        'apps/desktop/release/*.msi',
      ].join('\n')}\n`,
      'if-no-files-found': 'error',
      'retention-days': 7,
      'compression-level': 0,
    })
  })

  it('does not cancel a master push while a later push starts another Release', () => {
    expect(workflow.concurrency).toEqual({
      group: "${{ github.workflow }}-${{ github.event_name == 'push' && github.sha || github.ref }}",
      'cancel-in-progress': "${{ github.event_name != 'push' }}",
    })
  })

  it('publishes unsigned Windows x64 and macOS arm64 installers only on master pushes', () => {
    const release = workflowJob(workflow, 'release')
    const releaseSteps = jobSteps(release)
    const downloads = releaseSteps.filter(step => (
      typeof step.uses === 'string' && step.uses.startsWith('actions/download-artifact@')
    ))
    const publish = namedStep(releaseSteps, 'Publish GitHub Release')
    const script = String(publish.run)

    expect(Object.keys(workflow.jobs ?? {}).sort()).toEqual(['build', 'release'])
    expect(release.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(release.needs).toBe('build')
    expect(release['runs-on']).toBe('ubuntu-latest')
    expect(release.permissions).toEqual({ contents: 'write' })
    expect(usesStep(releaseSteps, 'actions/checkout@').with).toEqual({ 'persist-credentials': false })
    expect(downloads.map(step => step.uses)).toEqual([
      'actions/download-artifact@v8',
      'actions/download-artifact@v8',
    ])
    expect(downloads.map(step => step.with)).toEqual([
      { name: 'dsh-desktop-macos-arm64', path: 'release' },
      { name: 'dsh-desktop-windows-x64', path: 'release' },
    ])
    expect(publish.env).toEqual({ GH_TOKEN: '${{ github.token }}' })
    expect(script).toContain("require('./apps/desktop/package.json').version")
    expect(script).toContain('desktop-v${version}-g${GITHUB_SHA}')
    expect(script).toContain('DeepSeek Harness Desktop v${version} (${GITHUB_SHA:0:12})')
    expect(script).toContain('DeepSeek Harness-${version}-mac-arm64.dmg')
    expect(script).toContain('DeepSeek Harness-${version}-mac-arm64.zip')
    expect(script).toContain('DeepSeek Harness-${version}-win-x64.exe')
    expect(script).toContain('DeepSeek Harness-${version}-win-x64.msi')
    expect(script).toContain('sha256sum')
    expect(script).toContain('SHA256SUMS')
    expect(script).toContain('gh release view')
    expect(script).toContain('--json isDraft')
    expect(script).toContain('release_state')
    expect(script).toContain('== "published"')
    expect(script).toContain('== "missing"')
    expect(script).toContain('!= "draft"')
    const createIndex = script.indexOf('gh release create')
    const uploadIndex = script.indexOf('gh release upload')
    const publishIndex = script.indexOf('gh release edit')
    expect(createIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeLessThan(uploadIndex)
    expect(uploadIndex).toBeLessThan(publishIndex)
    expect(script).toContain('--draft')
    expect(script).toContain('--generate-notes')
    expect(script).toContain('--target "${GITHUB_SHA}"')
    expect(script).toContain('--clobber')
    expect(script).toContain('--draft=false')
    expect(script).toContain('--prerelease')
    expect(script).toMatch(/version.+== \*-\*/)
    expect(script).not.toContain('dsh-desktop-macos-x64')
    expect(script).not.toContain('dsh-desktop-linux-x64')
    expect(script).not.toContain('mac-x64')
    expect(script).not.toContain('linux-x64')
    expect(script).not.toMatch(/AppImage|\.deb/u)
    expect(JSON.stringify(release)).not.toMatch(/softprops|ncipollo|action-gh-release/u)
  })

  it('declares the Group plugin that app-boot requires at Host boot', () => {
    const manifest = JSON.parse(readFileSync(resolve('apps/desktop/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/cordis-plugin-group']).toBe('workspace:^')
  })

  it('contains no Tauri, Rust, sidecar, SEA, signing secret, updater, or registry publication', () => {
    walk(workflow, (value, path) => {
      if (typeof value !== 'string') return
      expect(value, path).not.toMatch(/tauri|rust|sidecar|pkg-target|src-tauri|--sea/iu)
      expect(value, path).not.toMatch(/\$\{\{\s*secrets\./u)
      expect(value, path).not.toMatch(/notari[sz]|auto.?update|electron-updater/iu)
      expect(value, path).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|registry\.npmjs|pypi|twine/iu)
    })
  })
})
