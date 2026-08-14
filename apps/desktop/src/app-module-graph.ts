/**
 * Point Node's extra module search path at the Electron application's
 * `node_modules` so profile-anchored Loader `createRequire` can resolve
 * in-box plugins after the ordinary parent-directory walk.
 * @module @deepseek-ai/dsh-desktop/app-module-graph
 */

import { Module } from 'node:module'
import { delimiter, join } from 'node:path'

/**
 * Prepend `<appPath>/node_modules` to `NODE_PATH` and rebuild Node's extra
 * module paths. `NODE_PATH` is otherwise read only at process start.
 *
 * `healProfilesModuleFallback` writes `$DSH_HOME/profiles/node_modules`
 * symlinks into the installation graph. When that graph lives inside
 * `app.asar`, those inbound symlinks exist on disk but `existsSync` and
 * `require.resolve` treat them as missing: Electron's asar overlay is
 * visible only through paths that already enter the archive. Extra paths
 * are searched after the parent walk, so a profile-local package still wins.
 *
 * @param appPath - `app.getAppPath()` (`…/app.asar` when packaged).
 */
export function exposeAppModuleGraph(appPath: string): void {
  const appModules = join(appPath, 'node_modules')
  const existing = process.env.NODE_PATH
  process.env.NODE_PATH = existing === undefined || existing === ''
    ? appModules
    : `${appModules}${delimiter}${existing}`
  // Public `node:module` types omit the startup-only rebuild hook.
  ;(Module as typeof Module & { _initPaths(): void })._initPaths()
}
