import { describe, expect, it, vi } from 'vitest'
import { PYTHON_SDK_CLOSURE, parsePythonSdkTargets } from './build-exe-for-python-sdk.ts'
import {
  DEFAULT_ASSET_GLOBS,
  ExeClosureBuild,
  PkgTarget,
  parseExeClosureCli,
  parseTargetList,
} from './exe-closure.ts'

describe('PkgTarget', () => {
  it('parses linux, macos, and windows targets', () => {
    expect(PkgTarget.parse('node24-linux-x64').spec).toBe('node24-linux-x64')
    expect(PkgTarget.parse('node24-macos-arm64').spec).toBe('node24-macos-arm64')
    expect(PkgTarget.parse('node24-win-x64').spec).toBe('node24-win-x64')
  })

  it('rejects malformed and unsupported targets', () => {
    expect(() => PkgTarget.parse('node24-windows-x64')).toThrow(/platform must be one of/)
    expect(() => PkgTarget.parse('node24-win32-x64')).toThrow(/platform must be one of/)
    expect(() => PkgTarget.parse('linux-x64')).toThrow(/must be <nodeRange>-<platform>-<arch>/)
    expect(() => PkgTarget.parse('node24-linux-ia32')).toThrow(/arch must be one of/)
  })
})

describe('parseTargetList', () => {
  it('rejects colliding platform-arch pairs', () => {
    expect(() => parseTargetList('node24-linux-x64,node22-linux-x64')).toThrow(/duplicate platform-arch linux-x64/)
  })

  it('rejects an empty list', () => {
    expect(() => parseTargetList('')).toThrow(/--targets is empty/)
  })
})

describe('executable closure CLI', () => {
  const usage = 'Usage: builder [flags]'

  it('parses the shared target and execution flags', () => {
    const parsed = parseExeClosureCli(
      ['--targets=node24-linux-x64', '--skip-build', '--dry-run'],
      { label: 'builder', usage, parseTargets: parseTargetList },
    )

    expect(parsed.targets.map(target => target.spec)).toEqual(['node24-linux-x64'])
    expect(parsed.skipBuild).toBe(true)
    expect(parsed.dryRun).toBe(true)
  })

  it('prints help and exits successfully', () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`)
    })

    expect(() => parseExeClosureCli(['--help'], { label: 'builder', usage, parseTargets: parseTargetList }))
      .toThrow('exit 0')
    expect(stdout).toHaveBeenCalledWith(usage)
    exit.mockRestore()
    stdout.mockRestore()
  })

  it('labels malformed flags, prints usage, and exits with failure', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`)
    })

    expect(() => parseExeClosureCli(['--unknown'], { label: 'builder', usage, parseTargets: parseTargetList }))
      .toThrow('exit 1')
    expect(stderr.mock.calls.flat().join(' ')).toContain('builder:')
    expect(stderr).toHaveBeenCalledWith(usage)
    exit.mockRestore()
    stderr.mockRestore()
  })
})

describe('Python executable closure', () => {
  it('uses pkg product names and the default asset set', () => {
    expect(PYTHON_SDK_CLOSURE.deployPackage).toBe('dsh-jsonrpc-agent-pkg')
    expect(PYTHON_SDK_CLOSURE.entryBin).toBe('node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js')
    expect(PYTHON_SDK_CLOSURE.assetGlobs).toBe(DEFAULT_ASSET_GLOBS)
    expect(PYTHON_SDK_CLOSURE.assetGlobs).not.toContain('node_modules/**/*.yml')
    expect(DEFAULT_ASSET_GLOBS).toEqual(expect.arrayContaining([
      'node_modules/**/*.node',
      'node_modules/@img/sharp-libvips-*/lib/*.dylib',
      'node_modules/@img/sharp-libvips-*/lib/*.so*',
      'node_modules/@img/sharp-libvips-*/lib/*.dll',
    ]))
  })

  it('keeps build optional while always preparing staging', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pipeline = new ExeClosureBuild('/repo', PYTHON_SDK_CLOSURE, { dryRun: true })

    await pipeline.prepareStaging(true)

    const output = log.mock.calls.flat().join(' ')
    expect(output).toContain('skipping pnpm run build (--skip-build)')
    expect(output).toContain('deploy --prod')
    expect(output).toContain('patch')
    log.mockRestore()
  })

  it('uses lockfile-backed production deploy without legacy source pruning', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pipeline = new ExeClosureBuild('/repo', PYTHON_SDK_CLOSURE, { dryRun: true })

    await pipeline.deployStaging()

    const deploy = log.mock.calls.flat().join(' ')
    expect(deploy).toContain('deploy --prod --config.node-linker=hoisted --config.inject-workspace-packages=true')
    expect(deploy).not.toContain('--legacy')
    log.mockRestore()
  })
})

describe('Python SDK targets', () => {
  it('accepts Linux and macOS and rejects Windows', () => {
    expect(parsePythonSdkTargets('node24-linux-x64,node24-macos-arm64').map(target => target.spec))
      .toEqual(['node24-linux-x64', 'node24-macos-arm64'])
    expect(() => parsePythonSdkTargets('node24-win-x64')).toThrow(/platform must be one of linux, macos; got win/)
    expect(() => parsePythonSdkTargets('node24-linux-x64,node24-win-x64')).toThrow(/platform must be one of linux, macos; got win/)
  })
})
