/**
 * Shared executable-closure machinery for `@yao-pkg/pkg --sea` products.
 * The Python SDK runtime consumes this module for CLI flags, target parsing,
 * hoisted deploy, symlink materialization, and packaging.
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
/** Default Node major; SEA mode requires at least Node 22. */
export const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
export const PKG_SPEC = '@yao-pkg/pkg@6.21.0'

/**
 * Whole-tree assets cover Cordis's runtime bare-package imports, which pkg's
 * static analysis cannot see. Package manifests are explicit because bare-name
 * resolution depends on them. `@img/sharp-libvips-*` ships the platform
 * libvips next to sharp's `.node` (e.g. `lib/libvips-cpp.8.18.3.dylib`);
 * those shared libraries are not discovered as `.node`/`.wasm`.
 */
export const DEFAULT_ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  'node_modules/**/*.node',
  'node_modules/**/*.wasm',
  'node_modules/@img/sharp-libvips-*/lib/*.dylib',
  'node_modules/@img/sharp-libvips-*/lib/*.so*',
  'node_modules/@img/sharp-libvips-*/lib/*.dll',
] as const

/** pkg platform tags. `win` is pkg's Windows target (`process.platform` is `win32`). */
const PKG_PLATFORMS = ['linux', 'macos', 'win'] as const
const PKG_ARCHES = ['x64', 'arm64'] as const
export type PkgPlatform = (typeof PKG_PLATFORMS)[number]
export type PkgArch = (typeof PKG_ARCHES)[number]

export interface ClosureConfig {
  /** Log and error prefix. */
  label: string
  /** pnpm `--filter` package whose dependencies define the closure. */
  deployPackage: string
  /** Cleared deploy target and pkg input. */
  stagingDir: string
  /** Fallback source for direct packages omitted from the deployed closure. */
  deploySourceNodeModules: string
  /** Closed-runtime entry inside the staged closure. */
  entryBin: string
  /** pkg `assets` globs injected into the staged manifest. */
  assetGlobs: readonly string[]
  /** Documentation stripped from the staged deploy root. */
  deployOnlyDocs?: readonly string[]
  /** Directory that receives packaged executables. */
  outDir: string
  /** Product filename stem before the platform suffix. */
  outputBasename: string
}

function isPkgPlatform(value: string): value is PkgPlatform {
  return (PKG_PLATFORMS as readonly string[]).includes(value)
}

function isPkgArch(value: string): value is PkgArch {
  return (PKG_ARCHES as readonly string[]).includes(value)
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
export class PkgTarget {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /** pkg platform tag. */
    readonly platform: PkgPlatform,
    /** pkg CPU tag. */
    readonly arch: PkgArch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-linux-x64` or `node24-win-x64`.
   * @returns the parsed target.
   */
  static parse(spec: string): PkgTarget {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-linux-x64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPkgPlatform(platform)) {
      throw new Error(`target ${JSON.stringify(spec)}: platform must be one of ${PKG_PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isPkgArch(arch)) {
      throw new Error(`target ${JSON.stringify(spec)}: arch must be one of ${PKG_ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    return new PkgTarget(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(): PkgTarget {
    const platform = hostPkgPlatform(process.platform)
    if (platform === undefined) {
      throw new Error(`unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    return new PkgTarget(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/** Map `process.platform` onto a pkg platform tag. */
function hostPkgPlatform(nodePlatform: NodeJS.Platform): PkgPlatform | undefined {
  if (nodePlatform === 'darwin') return 'macos'
  if (nodePlatform === 'linux') return 'linux'
  if (nodePlatform === 'win32') return 'win'
  return undefined
}

/**
 * Parse a comma-separated `--targets` list, defaulting to the host.
 * Duplicate platform-arch pairs fail: canonical product names would collide.
 */
export function parseTargetList(raw: string | undefined): PkgTarget[] {
  const targets = raw === undefined
    ? [PkgTarget.host()]
    : raw.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => PkgTarget.parse(spec))
  if (targets.length === 0) throw new Error('--targets is empty.')
  const seen = new Set<string>()
  for (const target of targets) {
    const key = `${target.platform}-${target.arch}`
    if (seen.has(key)) {
      throw new Error(`duplicate platform-arch ${key} in --targets; canonical product names would collide.`)
    }
    seen.add(key)
  }
  return targets
}

export function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Parsed `--targets`, `--skip-build`, and `--dry-run` flags for an exe-closure builder.
 */
export interface ExeClosureCli {
  /** Build targets; `parseTargets` supplies the default when `--targets` is omitted. */
  readonly targets: readonly PkgTarget[]
  /** Skip `pnpm run build`; compiled artifacts must already exist. */
  readonly skipBuild: boolean
  /** Print every command and config patch instead of executing. */
  readonly dryRun: boolean
}

/**
 * Parse the shared exe-closure CLI flags.
 * `--help` prints `usage` and exits 0. Unknown flags print the parse error
 * and `usage`, then exit 1. Errors from `parseTargets` propagate unchanged.
 */
export function parseExeClosureCli(
  argv: readonly string[],
  options: {
    readonly label: string
    readonly usage: string
    readonly parseTargets: (raw: string | undefined) => PkgTarget[]
  },
): ExeClosureCli {
  let values: {
    targets?: string
    'skip-build': boolean
    'dry-run': boolean
    help: boolean
  }
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        targets: { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }).values
  } catch (error) {
    console.error(`${options.label}: ${error instanceof Error ? error.message : String(error)}\n`)
    console.error(options.usage)
    process.exit(1)
  }
  if (values.help) {
    console.log(options.usage)
    process.exit(0)
  }
  return {
    targets: options.parseTargets(values.targets),
    skipBuild: values['skip-build'],
    dryRun: values['dry-run'],
  }
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential closure pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
export class ExeClosureBuild {
  readonly staging: string
  readonly outDir: string
  private readonly root: string
  private readonly config: ClosureConfig
  private readonly dryRun: boolean

  constructor(root: string, config: ClosureConfig, options: { dryRun: boolean }) {
    this.root = root
    this.config = config
    this.dryRun = options.dryRun
    this.staging = resolve(root, config.stagingDir)
    this.outDir = resolve(root, config.outDir)
  }

  /**
   * Run `pnpm run build` unless `skipBuild`, then deploy the staging tree and
   * inject the pkg entry and assets. `--skip-build` does not skip deploy.
   */
  async prepareStaging(skipBuild: boolean): Promise<void> {
    if (skipBuild) {
      this.log('skipping pnpm run build (--skip-build)')
    } else {
      await this.run('build', pnpmBin(), ['run', 'build'])
    }
    await this.deployStaging()
    await this.injectPkgConfig()
  }

  /** Clear and deploy the runtime closure into the staging directory. */
  async deployStaging(): Promise<void> {
    if (this.staging === this.root || this.root.startsWith(this.staging + sep)) {
      throw new Error(`${this.config.label}: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    if (this.dryRun) this.log(`[dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), [
      '--filter',
      this.config.deployPackage,
      'deploy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.inject-workspace-packages=true',
      '--config.strict-dep-builds=false',
      this.staging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    const docs = this.config.deployOnlyDocs ?? []
    if (this.dryRun) {
      for (const name of docs) this.log(`[dry-run] rm -f ${join(this.staging, name)}`)
    } else {
      await Promise.all(docs.map(name => rm(join(this.staging, name), { force: true })))
    }
  }

  /**
   * Restore any direct package omitted from the deployed closure. The runtime
   * manifest supplies every peer, so package-local node_modules trees are
   * omitted to preserve one flat Cordis instance and a symlink-free payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.dryRun) {
      this.log('[dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(this.root, this.config.deploySourceNodeModules)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.staging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `${this.config.label}: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.staging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`${this.config.label}: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      this.log(`restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.dryRun) {
      this.log('[dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    const patch = { bin: this.config.entryBin, pkg: { assets: this.config.assetGlobs } }
    const manifestPath = join(this.staging, 'package.json')
    if (this.dryRun) {
      this.log(`[dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
      return
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`${this.config.label}: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, this.config.entryBin))) {
      throw new Error(`${this.config.label}: ${join(this.staging, this.config.entryBin)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
    this.log(`injected pkg config into ${manifestPath}`)
  }

  /** Absolute product path for one packaged target. */
  productPath(target: PkgTarget): string {
    return join(this.outDir, `${this.config.outputBasename}-${target.platform}-${target.arch}`)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation.
   * @param target - the pkg target triple to build.
   * @returns the executable path and, on macOS, its helper path when configured.
   */
  async pack(target: PkgTarget): Promise<string[]> {
    const product = this.productPath(target)
    await this.prepareNativePty(target)
    if (!this.dryRun) await mkdir(this.outDir, { recursive: true })
    await this.run(`pkg ${target.spec}`, pnpmBin(), [
      'dlx',
      PKG_SPEC,
      this.staging,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      product,
    ])
    if (!this.dryRun && !existsSync(product)) {
      throw new Error(`${this.config.label}: product ${product} is missing after the pkg run; inspect ${this.outDir}.`)
    }
    const helper = await this.copySpawnHelper(target, product)
    return helper === undefined ? [product] : [product, helper]
  }

  /**
   * Put the target node-pty addon in the staged closure. Linux npm installs
   * build it from source, but legacy deploy omits that side-effect directory.
   * Native-target builds are explicit: a cross-arch copy fails loud.
   * @param target - the pkg target whose native addon is being staged.
   */
  private async prepareNativePty(target: PkgTarget): Promise<void> {
    const stagedBuild = join(this.staging, 'node_modules', 'node-pty', 'build')
    if (this.dryRun) this.log(`[dry-run] rm -rf ${stagedBuild}`)
    else await rm(stagedBuild, { recursive: true, force: true })
    if (target.platform !== 'linux') return
    const source = join(this.root, 'packages', 'subprocess', 'subprocess-local', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node')
    const destination = join(stagedBuild, 'Release', 'pty.node')
    if (this.dryRun) {
      this.log(`[dry-run] cp ${source} ${destination}`)
      return
    }
    const host = PkgTarget.host()
    if (target.platform !== host.platform || target.arch !== host.arch) {
      throw new Error(
        `${this.config.label}: build the Linux runtime on its target architecture; `
        + `target ${target.platform}-${target.arch} does not match host ${host.platform}-${host.arch}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  /**
   * Copy node-pty's macOS spawn helper beside the packaged product.
   * @returns the helper path, or `undefined` when this target has no helper.
   */
  private async copySpawnHelper(target: PkgTarget, product: string): Promise<string | undefined> {
    if (target.platform !== 'macos') return undefined
    const source = join(this.staging, 'node_modules', 'node-pty', 'prebuilds', `darwin-${target.arch}`, 'spawn-helper')
    const helper = `${product}-spawn-helper`
    if (this.dryRun) {
      this.log(`[dry-run] cp ${source} ${helper}`)
      return helper
    }
    await copyFile(source, helper)
    await chmod(helper, 0o755)
    return helper
  }

  /**
   * Print each product path and, outside dry-run mode, its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    this.log(this.dryRun ? '[dry-run] would produce:' : 'products:')
    for (const path of products) {
      if (this.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      const megabytes = statSync(path).size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }

  /**
   * Copy each product into another directory, preserving the execute bit.
   * @param products - the product paths returned by {@link pack}.
   * @param destDir - destination directory.
   */
  async copyProducts(products: string[], destDir: string): Promise<void> {
    const destinationRoot = resolve(this.root, destDir)
    if (this.dryRun) {
      for (const path of products) {
        this.log(`[dry-run] cp ${path} ${join(destinationRoot, basename(path))}`)
      }
      return
    }
    await mkdir(destinationRoot, { recursive: true })
    for (const path of products) {
      const destination = join(destinationRoot, basename(path))
      await copyFile(path, destination)
      await chmod(destination, statSync(path).mode & 0o777)
      this.log(`synced ${destination}`)
    }
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
   * include the command; dry runs only print it.
   *
   * # Parameters
   * - `env`: extra variables merged over the inherited environment (`CI` stays set).
   */
  async run(step: string, command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.dryRun) {
      this.log(`[dry-run] ${printable}`)
      return
    }
    this.log(`${step}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: this.root,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true', ...env },
      })
      child.once('error', (error) => {
        reject(new Error(`${this.config.label}: ${step} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`${this.config.label}: ${step} failed (${cause}): ${printable}`))
      })
    })
  }

  private log(message: string): void {
    console.log(`${this.config.label}: ${message}`)
  }
}
