/**
 * Host half of the token gauge bundle.
 *
 * The credit gauge reads the signed-in account's balance through the shipped
 * `ctx.remote.account` namespace, and the context reading comes from the
 * shipped `contextPressure` projection, so this half owns no state of its own:
 * the row exists so the bundle has a Host entry, and the Client module renders
 * both readouts.
 *
 * @module @local/dsh-token-gauge
 */

/** Display name used by Cordis diagnostics. */
export const name = 'token-gauge';

/** Nothing to register: both readouts are client-side reads of shipped sources. */
export function apply() {}
