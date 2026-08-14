import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SCHEME,
  contentTypeForDesktopAsset,
  desktopAppUrl,
  isDesktopAppDocumentUrl,
  resolveDesktopAppPath,
} from '../src/desktop-protocol.ts'

describe('desktop privileged renderer URLs', () => {
  it('names the application document', () => {
    expect(desktopAppUrl()).toBe(`${DESKTOP_SCHEME}://app/index.html`)
    expect(isDesktopAppDocumentUrl(new URL(desktopAppUrl()))).toBe(true)
    expect(isDesktopAppDocumentUrl(new URL(`${DESKTOP_SCHEME}://app/index.html?x=1`))).toBe(false)
    expect(isDesktopAppDocumentUrl(new URL(`${DESKTOP_SCHEME}://bundle/client.js`))).toBe(false)
  })

  it('maps app pathnames onto the Web root and rejects escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-protocol-'))
    await writeFile(join(root, 'index.html'), '<!doctype html>')
    expect(resolveDesktopAppPath(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveDesktopAppPath(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'))
    expect(resolveDesktopAppPath(root, '/../secret')).toBeUndefined()
    expect(resolveDesktopAppPath(root, '/%2e%2e/secret')).toBeUndefined()
    expect(resolveDesktopAppPath(root, '/..\\secret')).toBeUndefined()
  })

  it('labels JavaScript modules as executable script', () => {
    expect(contentTypeForDesktopAsset('/tmp/index-CCtBptR9.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeForDesktopAsset('/tmp/index.html')).toBe('text/html; charset=utf-8')
  })
})
