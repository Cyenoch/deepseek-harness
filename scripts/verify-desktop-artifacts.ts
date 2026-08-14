/** Verify the native Electron artifact pair emitted for one CI matrix target. */

import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_ARTIFACTS: Record<string, readonly RegExp[]> = {
  'macos-arm64': [/arm64\.dmg$/u, /arm64\.zip$/u],
  'macos-x64': [/x64\.dmg$/u, /x64\.zip$/u],
  'linux-x64': [/x64\.AppImage$/u, /x64\.deb$/u],
  'windows-x64': [/x64\.exe$/u, /x64\.msi$/u],
}

/**
 * Check that every expected installer/archive exists and is nonempty.
 * @param target - CI matrix target.
 * @param directory - electron-builder output directory.
 * @returns matching artifact filenames.
 */
export function verifyDesktopArtifacts(target: string, directory: string): string[] {
  const patterns = EXPECTED_ARTIFACTS[target]
  if (patterns === undefined) throw new Error(`desktop artifacts: unsupported target ${JSON.stringify(target)}`)
  const root = resolve(directory)
  const files = readdirSync(root).filter(name => statSync(resolve(root, name)).isFile())
  const matches = patterns.map((pattern) => {
    const name = files.find(candidate => pattern.test(candidate))
    if (name === undefined) {
      throw new Error(`desktop artifacts: ${target} missing ${String(pattern)} in ${root}; found ${files.join(', ')}`)
    }
    const path = resolve(root, name)
    if (statSync(path).size === 0) throw new Error(`desktop artifacts: ${path} is empty`)
    return name
  })
  return matches
}

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = readFlag('target')
  const directory = process.argv.slice(2).find(arg => !arg.startsWith('--'))
  if (target === undefined || directory === undefined) {
    throw new Error('usage: verify-desktop-artifacts --target=<target> <directory>')
  }
  for (const name of verifyDesktopArtifacts(target, directory)) console.log(name)
}
