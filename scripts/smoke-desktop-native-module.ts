/** Smoke packaged Electron native assets and the shipped Agent tool runtime. */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packagedRipgrepPath } from '../apps/desktop/src/packaged-executables.ts'

const MARKER = 'desktop-runtime-ok'
const SMOKE_PROGRAM = String.raw`
const { spawn: spawnPty } = require(process.argv[1])
const shell = process.argv[2]
const args = JSON.parse(process.argv[3])
const marker = process.argv[4]
const ripgrep = process.argv[5]
const appAsar = process.argv[6]
const target = process.argv[7]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertSuccess(result, label) {
  if (result.isError) throw new Error(label + ' failed: ' + JSON.stringify(result))
  return result.value
}

function assertFailure(result, label, expected) {
  if (!result.isError) throw new Error(label + ' unexpectedly succeeded: ' + JSON.stringify(result))
  const rendered = JSON.stringify(result)
  if (expected !== undefined && !rendered.includes(expected)) {
    throw new Error(label + ' failed for the wrong reason: ' + rendered)
  }
}

function progress(label) {
  process.stderr.write('[desktop-runtime-smoke] ' + label + '\n')
}

function smokeRipgrep() {
  const run = require('node:child_process').spawnSync(ripgrep, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  assert(!run.error && run.status === 0 && run.stdout.includes('ripgrep'),
    'ripgrep failed: ' + String(run.error || run.stderr || run.stdout))
}

function smokePty() {
  return new Promise((resolve, reject) => {
    const terminal = spawnPty(shell, args, { cols: 80, rows: 24, env: process.env })
    let output = ''
    let settled = false
    const timeout = setTimeout(() => finish(1, 'timed out'), 10_000)
    terminal.onData(data => { output += data })
    terminal.onExit(({ exitCode }) => finish(exitCode, 'exited'))
    function finish(exitCode, reason) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (exitCode === 0 && output.includes(marker)) resolve()
      else reject(new Error('node-pty ' + reason + ' with code ' + exitCode + ': ' + output))
    }
  })
}

async function smokeAgentTools() {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { dirname, join } = require('node:path')
  const { createRequire, Module } = require('node:module')
  const { pathToFileURL } = require('node:url')
  const home = mkdtempSync(join(tmpdir(), 'dsh-packaged-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-packaged-workspace-'))
  const skillPath = join(workspace, '.agents', 'skills', 'packaged-smoke', 'SKILL.md')
  mkdirSync(dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, '---\nname: packaged-smoke\ndescription: Packaged runtime smoke skill\n---\n\npackaged-skill-ok\n')

  process.env.DSH_HOME = home
  process.env.DSH_RIPGREP_PATH = ripgrep
  process.env.DSH_TELEMETRY_DISABLED = '1'
  process.env.DSH_PERMISSION_MODE = 'workspace-write'
  process.env.NODE_PATH = join(appAsar, 'node_modules')
  Module._initPaths()

  const appRequire = createRequire(join(appAsar, 'package.json'))
  const load = async name => import(pathToFileURL(appRequire.resolve(name)).href)
  const { loadLayeredEnv } = await load('@deepseek-ai/dsh-app-boot')
  const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
  const { DirectoryPicker } = await load('@deepseek-ai/dsh-host-directory-picker')
  const { CallId } = await load('@deepseek-ai/dsh-llm')
  const { SessionId } = await load('@deepseek-ai/dsh-session')

  class StubDirectoryPicker extends DirectoryPicker {
    capability() { return { kind: 'native', pick: async () => null } }
  }

  let host
  let handle
  let cordisHandle
  let call = 0
  try {
    progress('profile boot started')
    host = await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: 'desktop',
      patchFiles: [],
      args: [],
      prepare: async ctx => { await ctx.plugin(StubDirectoryPicker) },
    })
    progress('profile boot completed')
    const ctx = host.ctx
    handle = await ctx.agents.create({
      sessionId: SessionId('packaged-agent-tool-smoke'),
      meta: { cwd: workspace },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    progress('standard Agent mounted')
    const agent = handle.agent
    const shellTool = target === 'windows-x64' ? 'pwsh' : 'bash'
    const expected = [
      'ask_user_question', shellTool, 'create_goal', 'edit', 'exit_plan_mode',
      'get_goal', 'glob', 'grep', 'interrupt_agent', 'job_kill', 'job_list',
      'job_output', 'list_agents', 'ralph', 'read', 'read_image', 'send_message',
      'skill', 'subagent', 'subagent_fork', 'todo_write', 'update_goal',
      'web_search', 'workflow', 'write',
    ].sort()
    const names = ctx.tools.schemas(agent).map(schema => schema.name).sort()
    assert(JSON.stringify(names) === JSON.stringify(expected), 'unexpected Agent tool catalog: ' + JSON.stringify(names))

    const executeFor = (actingAgent, name, arguments) => ctx.agents.withInitiator(actingAgent, () => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('packaged-tool-' + String(++call)),
      name,
      arguments,
      agent: actingAgent,
    }))
    const execute = (name, arguments) => executeFor(agent, name, arguments)

    const file = join(workspace, 'tool-smoke.txt')
    assertFailure(await execute('read', { file_path: file }), 'read missing file')
    assertSuccess(await execute('write', { file_path: file, content: 'alpha needle\n' }), 'write')
    const read = assertSuccess(await execute('read', { file_path: file }), 'read')
    assert(JSON.stringify(read).includes('alpha needle'), 'read returned the wrong content')
    assertSuccess(await execute('edit', { file_path: file, old_string: 'alpha', new_string: 'beta' }), 'edit')
    const glob = assertSuccess(await execute('glob', { pattern: '*.txt', path: workspace }), 'glob')
    assert(glob.paths.some(path => path.endsWith('tool-smoke.txt')), 'glob omitted the smoke file')
    const grep = assertSuccess(await execute('grep', { pattern: 'needle', path: workspace }), 'grep')
    assert(grep.matches.some(match => match.path.endsWith('tool-smoke.txt')), 'grep omitted the smoke match')
    progress('filesystem tools completed')

    const foregroundCommand = target === 'windows-x64'
      ? 'Write-Output packaged-shell-ok'
      : 'printf packaged-shell-ok'
    const foreground = assertSuccess(await execute(shellTool, {
      command: foregroundCommand,
      description: 'Print packaged shell marker',
      workdir: workspace,
    }), shellTool)
    assert(foreground.kind === 'foreground' && foreground.stdout.text.includes('packaged-shell-ok'), shellTool + ' returned the wrong output')
    progress('foreground shell completed')

    const background = assertSuccess(await execute(shellTool, {
      command: foregroundCommand,
      description: 'Run packaged background marker',
      workdir: workspace,
      run_in_background: true,
    }), shellTool + ' background')
    const backgroundOutput = assertSuccess(await execute('job_output', {
      job_id: background.jobId,
      wait: true,
      timeout_ms: 10_000,
    }), 'job_output')
    assert(backgroundOutput.text.includes('packaged-shell-ok'), 'job_output omitted background output')
    assertSuccess(await execute('job_list', {}), 'job_list')
    assertSuccess(await execute('job_kill', { job_id: background.jobId, reason: 'packaged smoke complete' }), 'job_kill')
    progress('background shell completed')

    const skill = assertSuccess(await execute('skill', { name: 'packaged-smoke' }), 'skill')
    assert(skill.content.includes('packaged-skill-ok'), 'skill returned the wrong content')
    progress('workspace skill completed')

    cordisHandle = await ctx.agents.create({
      sessionId: SessionId('packaged-cordis-skill-smoke'),
      meta: { cwd: workspace },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'cordis').then(() => undefined),
    })
    const cordisAgent = cordisHandle.agent
    const cordisSkills = (await ctx.skills.list({ cwd: workspace, scope: cordisAgent })).map(skill => skill.name)
    assert(
      cordisSkills.includes('cordis-plugin-development'),
      'Cordis Agent omitted cordis-plugin-development: ' + JSON.stringify(cordisSkills),
    )
    assert(
      cordisSkills.includes('editing-cordis-compositions'),
      'Cordis Agent omitted editing-cordis-compositions: ' + JSON.stringify(cordisSkills),
    )
    const cordisSkill = assertSuccess(
      await executeFor(cordisAgent, 'skill', { name: 'cordis-plugin-development' }),
      'Cordis Agent skill',
    )
    assert(cordisSkill.content.includes('# Develop Dynamic Cordis Plugins'), 'Cordis Agent skill returned the wrong content')
    progress('Cordis skill completed')

    assertSuccess(await execute('todo_write', {
      todos: [{ content: 'Exercise packaged tools', status: 'completed' }],
    }), 'todo_write')
    assertSuccess(await execute('list_agents', {}), 'list_agents')
    const workflow = assertSuccess(await execute('workflow', {
      script: 'log("packaged-workflow-ok"); return { ok: true }',
      meta: { name: 'packaged-smoke', description: 'Exercise the packaged workflow worker' },
    }), 'workflow')
    assert(workflow.result.ok === true && workflow.agentsStarted === 0, 'workflow returned the wrong result')
    progress('workflow completed')
    const code = await ctx.codeRuntime.run({
      program: 'const value: number = 42; return value',
      bindings: [],
    })
    assert(code.error === undefined && code.value === 42, 'packaged code worker returned the wrong result: ' + JSON.stringify(code))
    progress('code runtime completed')

    if (target === 'windows-x64') {
      const { pickNativeDirectory } = await load('@deepseek-ai/dsh-host-directory-picker-native')
      const controller = new AbortController()
      const abort = setTimeout(() => { controller.abort() }, 400)
      try {
        await pickNativeDirectory(controller.signal)
        throw new Error('packaged native directory picker unexpectedly completed')
      } catch (error) {
        assert(String(error).includes('native directory picker aborted'), 'packaged native directory picker failed: ' + String(error))
      } finally {
        clearTimeout(abort)
      }
      progress('native directory picker completed')
    }

    assertFailure(await execute('exit_plan_mode', { plan: '# Smoke' }), 'exit_plan_mode', 'only available in plan mode')
    assertFailure(await execute('read_image', { file_path: join(workspace, 'probe.png') }), 'read_image', 'does not declare image input')
    assertFailure(await execute('send_message', { subagent_id: 'missing-child', message: 'probe' }), 'send_message')
    assertSuccess(await execute('interrupt_agent', { agent_id: 'missing-child' }), 'interrupt_agent')
    progress('negative-path tools completed')
  } finally {
    if (cordisHandle !== undefined) {
      await cordisHandle.dispose()
      progress('Cordis Agent disposed')
    }
    if (handle !== undefined) {
      await handle.dispose()
      progress('standard Agent disposed')
    }
    if (host !== undefined) {
      await host.shutdown.shutdown(0)
      progress('profile shutdown completed')
    }
    rmSync(home, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
}

;(async () => {
  smokeRipgrep()
  progress('ripgrep completed')
  await smokePty()
  progress('node-pty completed')
  await smokeAgentTools()
  progress('Agent tools completed')
  process.stdout.write(marker)
})().catch(error => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
`

type DesktopTarget = 'macos-arm64' | 'windows-x64'

interface NativeSmokeSpec {
  readonly executable: string
  readonly appAsar: string
  readonly nodePty: string
  readonly ripgrep: string
  readonly shell: string
  readonly shellArgs: readonly string[]
}

/**
 * Resolve the packaged executable, ASAR module path, and native assets for one target.
 * @param target - Desktop workflow matrix target.
 * @param outputDirectory - electron-builder output directory.
 * @returns paths and shell command used by the packaged runtime smoke.
 */
function resolveNativeSmokeSpec(target: DesktopTarget, outputDirectory: string): NativeSmokeSpec {
  const root = resolve(outputDirectory)
  if (target === 'macos-arm64') {
    const resources = resolve(root, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'Resources')
    return {
      executable: resolve(root, 'mac-arm64', 'DeepSeek Harness.app', 'Contents', 'MacOS', 'DeepSeek Harness'),
      appAsar: resolve(resources, 'app.asar'),
      nodePty: resolve(resources, 'app.asar', 'node_modules', 'node-pty'),
      ripgrep: packagedRipgrepPath(resources, 'darwin', 'arm64'),
      shell: '/bin/sh',
      shellArgs: ['-c', `printf ${MARKER}`],
    }
  }
  const resources = resolve(root, 'win-unpacked', 'resources')
  return {
    executable: resolve(root, 'win-unpacked', 'DeepSeek Harness.exe'),
    appAsar: resolve(resources, 'app.asar'),
    nodePty: resolve(resources, 'app.asar', 'node_modules', 'node-pty'),
    ripgrep: packagedRipgrepPath(resources, 'win32', 'x64'),
    shell: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
    shellArgs: ['/d', '/s', '/c', `echo ${MARKER}`],
  }
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const target = readFlag('target')
  const outputDirectory = process.argv.slice(2).find(arg => !arg.startsWith('--'))
  if ((target !== 'macos-arm64' && target !== 'windows-x64') || outputDirectory === undefined) {
    throw new Error('usage: smoke-desktop-native-module --target=<macos-arm64|windows-x64> <output-directory>')
  }

  const spec = resolveNativeSmokeSpec(target, outputDirectory)
  for (const path of [spec.executable, spec.appAsar, spec.ripgrep]) {
    if (!existsSync(path)) throw new Error(`desktop native smoke: missing ${path}`)
  }

  const result = spawnSync(spec.executable, [
    '-e',
    SMOKE_PROGRAM,
    spec.nodePty,
    spec.shell,
    JSON.stringify(spec.shellArgs),
    MARKER,
    spec.ripgrep,
    spec.appAsar,
    target,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 60_000,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(
      `desktop native smoke process failed: ${String(result.error)}\n${result.stderr || result.stdout}`,
      { cause: result.error },
    )
  }
  if (result.status !== 0 || !result.stdout.includes(MARKER)) {
    throw new Error(`desktop native smoke failed with status ${String(result.status)}: ${result.stderr || result.stdout}`)
  }
  console.log(`${target}: ${MARKER}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
