import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDesktopArtifacts } from './verify-desktop-artifacts.ts'

function artifact(root: string, name: string, content = 'artifact'): void {
  writeFileSync(join(root, name), content)
}

describe('verifyDesktopArtifacts', () => {
  it.each([
    ['macos-arm64', ['DeepSeek Harness-0.1.0-mac-arm64.dmg', 'DeepSeek Harness-0.1.0-mac-arm64.zip']],
    ['macos-x64', ['DeepSeek Harness-0.1.0-mac-x64.dmg', 'DeepSeek Harness-0.1.0-mac-x64.zip']],
    ['linux-x64', ['DeepSeek Harness-0.1.0-linux-x64.AppImage', 'DeepSeek Harness-0.1.0-linux-x64.deb']],
    ['windows-x64', ['DeepSeek Harness-0.1.0-win-x64.exe', 'DeepSeek Harness-0.1.0-win-x64.msi']],
  ] as const)('accepts the %s artifact pair', (target, names) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-artifacts-'))
    for (const name of names) artifact(root, name)
    expect(verifyDesktopArtifacts(target, root).sort()).toEqual([...names].sort())
  })

  it('rejects missing, empty, and unknown target artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-electron-artifacts-'))
    artifact(root, 'DeepSeek Harness-0.1.0-mac-arm64.dmg')
    expect(() => verifyDesktopArtifacts('macos-arm64', root)).toThrow(/missing/u)
    const empty = join(root, 'DeepSeek Harness-0.1.0-mac-arm64.zip')
    closeSync(openSync(empty, 'w'))
    expect(() => verifyDesktopArtifacts('macos-arm64', root)).toThrow(/empty/u)
    expect(() => verifyDesktopArtifacts('other', root)).toThrow(/unsupported target/u)
  })
})
