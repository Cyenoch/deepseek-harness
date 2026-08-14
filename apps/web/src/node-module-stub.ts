/**
 * Browser stand-ins for Node builtins the vendored Loader imports. The
 * configured client path injects `loader.internal` and never reaches these.
 */

/** Throwing stand-in for node:module's createRequire (never reached in the browser boot). */
export const createRequire = (): never => {
  throw new Error('node:module is not available in the browser')
}

/** Erased type peer for the vendored loader's type-only LoadHookContext import. */
export type LoadHookContext = never

/** Stand-in for `node:path.isAbsolute` (never reached in the browser boot). */
export const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path)

/** Stand-in for `node:url.pathToFileURL` (never reached in the browser boot). */
export const pathToFileURL = (path: string): URL => new URL(path, 'file:///')
