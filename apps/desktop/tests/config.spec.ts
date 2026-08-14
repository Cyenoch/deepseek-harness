import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

interface BuilderConfig {
  appId: string
  productName: string
  asar: boolean
  electronLanguages: string[]
  files: string[]
  extraResources: Array<{ from: string; to: string }>
  asarUnpack: string[]
  artifactName: string
  mac: { identity: null; target: string[] }
  linux: { target: string[] }
  win: { target: string[] }
}

interface DesktopManifest {
  name: string
  private: boolean
  main: string
  dependencies: Record<string, string>
  scripts: Record<string, string>
  devDependencies: Record<string, string>
  files?: unknown
  publishConfig?: unknown
  build: BuilderConfig
}

function manifest(): DesktopManifest {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as DesktopManifest
}

describe('desktop Electron configuration', () => {
  it('keeps the application private and boots the built Electron main process', () => {
    const value = manifest()
    expect(value).toMatchObject({
      name: '@deepseek-ai/dsh-desktop',
      private: true,
      main: 'lib/main.js',
    })
    expect(value.dependencies['@deepseek-ai/dsh']).toMatch(/^workspace:/u)
    expect(value.devDependencies.electron).toBe('^43.4.0')
    expect(value.scripts.dev).toContain('scripts/dev-desktop.ts')
    expect(value.files).toBeUndefined()
    expect(value.publishConfig).toBeUndefined()
  })

  it('packages the embedded Host, preload, Web frontend, licenses, and native assets', () => {
    const { build } = manifest()
    expect(build).toMatchObject({
      appId: 'com.deepseek.dsh',
      productName: 'DeepSeek Harness',
      asar: true,
      electronLanguages: ['en', 'zh-CN'],
      artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
    })
    expect(build.files).toEqual(expect.arrayContaining([
      'lib/main.js',
      'lib/preload.cjs',
      'ui/**/*',
      'build/icon.png',
      'package.json',
    ]))
    expect(build.extraResources).toEqual(expect.arrayContaining([
      { from: '../web/dist', to: 'web' },
      { from: '../../LICENSE', to: 'LICENSE' },
      { from: '../../THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
    ]))
    expect(build.asarUnpack).toContain('**/@vscode/ripgrep-*/bin/**')
    expect(build.asarUnpack).toContain('**/@deepseek-ai/node-addon-landlock-run-*/bin/**')
  })

  it('builds unsigned inspection artifacts for each supported operating system', () => {
    const { build } = manifest()
    expect(build.mac).toMatchObject({ identity: null, target: ['dmg', 'zip'] })
    expect(build.linux.target).toEqual(['AppImage', 'deb'])
    expect(build.win.target).toEqual(['nsis', 'msi'])
    expect(JSON.stringify(build).toLowerCase()).not.toContain('publish')
    expect(JSON.stringify(build).toLowerCase()).not.toContain('updater')
  })
})
