/**
 * Privileged `dsh:` URL helpers for the desktop renderer document and static assets.
 * @module @deepseek-ai/dsh-desktop/desktop-protocol
 */
import { extname, resolve, sep } from 'node:path'

/** Privileged scheme registered before `app.ready`. */
export const DESKTOP_SCHEME = 'dsh'

/**
 * Return the renderer document URL after the embedded Host is ready.
 * @returns privileged application document URL.
 */
export function desktopAppUrl(): string {
  return `${DESKTOP_SCHEME}://app/index.html`
}

/**
 * Recognize the single privileged renderer document.
 * @param url - parsed navigation or sender URL.
 * @returns whether this is the application document with no query or fragment.
 */
export function isDesktopAppDocumentUrl(url: URL): boolean {
  return url.protocol === `${DESKTOP_SCHEME}:`
    && url.hostname === 'app'
    && url.pathname === '/index.html'
    && url.search === ''
    && url.hash === ''
}

/**
 * Resolve a `dsh://app` pathname onto the Web distribution root.
 * @param root - absolute Web asset root.
 * @param pathname - URL pathname beginning with `/`.
 * @returns absolute file path, or `undefined` when the path escapes the root.
 */
export function resolveDesktopAppPath(root: string, pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return undefined
  const path = resolve(root, `.${decoded}`)
  const resolvedRoot = resolve(root)
  if (path !== resolvedRoot && !path.startsWith(`${resolvedRoot}${sep}`)) return undefined
  return path
}

/**
 * Return the Content-Type for a desktop Web asset.
 * @param path - absolute asset path.
 * @returns MIME type Chromium accepts for that extension.
 */
export function contentTypeForDesktopAsset(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}
