/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-btw`.
 * @module @deepseek-ai/dsh-command-btw/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-btw'

/** Cordis companion plugin name. */
export const name = 'command-btw-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the parent log carries only the generic
 * `command/run`/`command/done` pairing, and the side exchange lives in a
 * separate child session whose events this package never observes from the
 * parent's stream.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
