/**
 * Build the SDK runtime executables and Python node carrier. The fixed
 * `@yao-pkg/pkg --sea` route, deploy flags, and artifact layout are owned by
 * .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.
 * Staging, target parsing, and packaging live in `exe-closure.ts`.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_ASSET_GLOBS,
  DEFAULT_NODE_RANGE,
  ExeClosureBuild,
  PKG_SPEC,
  type ClosureConfig,
  parseExeClosureCli,
  parseTargetList,
  pnpmBin,
  type PkgTarget,
} from './exe-closure.ts'

const PYTHON_PLATFORMS = ['linux', 'macos'] as const

/**
 * Parse `--targets` for the Python SDK executable. Shared `PkgTarget` accepts
 * Windows; this product does not.
 */
export function parsePythonSdkTargets(raw: string | undefined): PkgTarget[] {
  const targets = parseTargetList(raw)
  for (const target of targets) {
    if (target.platform === 'win') {
      throw new Error(
        `target ${JSON.stringify(target.spec)}: platform must be one of ${PYTHON_PLATFORMS.join(', ')}; got ${target.platform}.`,
      )
    }
  }
  return targets
}

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the executable. */
const DEPLOY_ROOT_PACKAGE = 'dsh-jsonrpc-agent-pkg'
/** The closed-runtime app entry inside the deployed closure. */
const ENTRY_BIN = 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js'
const OUTPUT_BASENAME = 'dsh-jsonrpc-agent-pkg'
const OUT_DIR = 'dist-exe'
/** Python package destination; created when absent. */
const PYTHON_RUNTIME_DIR = 'python/sdk-runtime/src/deepseek_harness_runtime/runtime'
/** The deployed closure doubles as the node-mode carrier. */
const PYTHON_NODE_SUBDIR = 'node'
/** Legacy deploy may hoist peer-specialized workspace packages back here. */
const DEPLOY_SOURCE_NODE_MODULES = 'python/sdk-runtime/node_modules'
/** Documentation excluded from the generated runtime directory. */
const DEPLOY_ONLY_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']

export const PYTHON_SDK_CLOSURE: ClosureConfig = {
  label: 'build-exe-for-python-sdk',
  deployPackage: DEPLOY_ROOT_PACKAGE,
  stagingDir: `${PYTHON_RUNTIME_DIR}/${PYTHON_NODE_SUBDIR}`,
  deploySourceNodeModules: DEPLOY_SOURCE_NODE_MODULES,
  entryBin: ENTRY_BIN,
  assetGlobs: DEFAULT_ASSET_GLOBS,
  deployOnlyDocs: DEPLOY_ONLY_DOCS,
  outDir: OUT_DIR,
  outputBasename: OUTPUT_BASENAME,
}

const PYTHON_SDK_USAGE = [
  'Usage: pnpm exec tsx scripts/build-exe-for-python-sdk.ts [flags]',
  '',
  '  --targets=<t1,t2,...>  pkg targets, e.g. node24-linux-x64,node24-linux-arm64,node24-macos-arm64.',
  `                         Default: the host platform only (on ${DEFAULT_NODE_RANGE}).`,
  '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
  '  --dry-run              print every command and config patch without executing.',
  '  --help                 print this help.',
  '',
  `Build route: ${PKG_SPEC} --sea; see `
    + '.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.',
  `Stages the node carrier in ${PYTHON_RUNTIME_DIR}/${PYTHON_NODE_SUBDIR} and writes executables to ${OUT_DIR}/.`,
].join('\n')

function parsePythonTargets(raw: string | undefined): PkgTarget[] {
  try {
    return parsePythonSdkTargets(raw)
  } catch (error) {
    throw new Error(`build-exe-for-python-sdk: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main(): Promise<void> {
  const cli = parseExeClosureCli(process.argv.slice(2), {
    label: 'build-exe-for-python-sdk',
    usage: PYTHON_SDK_USAGE,
    parseTargets: parsePythonTargets,
  })
  const pipeline = new ExeClosureBuild(root, PYTHON_SDK_CLOSURE, { dryRun: cli.dryRun })
  console.log(`build-exe-for-python-sdk: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
  console.log(`build-exe-for-python-sdk: staging: ${pipeline.staging}`)
  await pipeline.run('runtime dependency closure', pnpmBin(), ['run', 'verify-runtime-closure'])
  await pipeline.prepareStaging(cli.skipBuild)
  const products: string[] = []
  for (const target of cli.targets) products.push(...await pipeline.pack(target))
  pipeline.printProducts(products)
  await pipeline.copyProducts(products, PYTHON_RUNTIME_DIR)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  await main()
}
