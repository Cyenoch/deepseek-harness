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
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig*.json',
] as const

const DESKTOP_LEGS = [
  {
    target: 'macos-arm64',
    runner: 'node24-macos-arm64',
    'builder-args': '--mac dmg zip --arm64 --publish never',
  },
  {
    target: 'macos-x64',
    runner: 'node24-macos-x64',
    'builder-args': '--mac dmg zip --x64 --publish never',
  },
  {
    target: 'linux-x64',
    runner: 'node24-linux-x64',
    'builder-args': '--linux AppImage deb --x64 --publish never',
  },
  {
    target: 'windows-x64',
    runner: 'node24-win-x64',
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

  it('builds four native Electron targets without signing or publication', () => {
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
    expect(usesStep(steps, 'actions/upload-artifact@').with).toEqual({
      name: 'dsh-desktop-${{ matrix.target }}',
      path: 'apps/desktop/release/*',
      'if-no-files-found': 'error',
      'retention-days': 7,
    })
  })

  it('declares the Group plugin that app-boot requires at Host boot', () => {
    const manifest = JSON.parse(readFileSync(resolve('apps/desktop/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/cordis-plugin-group']).toBe('workspace:^')
  })

  it('contains no Tauri, Rust, sidecar, SEA, signing secret, or publish path', () => {
    walk(workflow, (value, path) => {
      if (typeof value !== 'string') return
      expect(value, path).not.toMatch(/tauri|rust|sidecar|pkg-target|src-tauri|--sea/iu)
      expect(value, path).not.toMatch(/\$\{\{\s*secrets\./u)
      expect(value, path).not.toMatch(/notari[sz]|auto.?update/iu)
    })
  })
})
