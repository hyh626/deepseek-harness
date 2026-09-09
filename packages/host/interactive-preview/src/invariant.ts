/** Package-owned invariant companion for interactive preview. @module @deepseek-ai/dsh-host-interactive-preview/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-interactive-preview'

/** Cordis companion plugin name. */
export const name = 'host-interactive-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: grant lifecycle and HTTP containment are exercised by
 * package tests; disposal quiescence is owned by the service effect.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the interactive-preview invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
