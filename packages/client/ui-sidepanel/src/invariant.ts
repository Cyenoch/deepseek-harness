/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-sidepanel`.
 * @module @deepseek-ai/dsh-client-ui-sidepanel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-sidepanel'

/** Cordis companion plugin name. */
export const name = 'client-ui-sidepanel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the side panel is browser viewing state over slots
 * and the layout store — it emits no cordis events and owns no cross-plugin
 * mutable state; tab behavior is asserted directly by this package's
 * component specs.
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
