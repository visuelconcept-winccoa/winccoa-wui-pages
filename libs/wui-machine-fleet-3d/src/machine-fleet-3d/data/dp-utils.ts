/** Shared helpers for datapoint name matching and value coercion. */

/**
 * Canonical DP key: drop system prefix, config/attribute suffix and trailing
 * dot, so a bound DPE string matches the (server-normalized) name echoed in
 * `dpConnect` emissions.
 */
export function normDp(dp: string): string {
  let s = dp.replace(/^[^:]+:/, '');
  const cfg = s.indexOf(':');
  if (cfg !== -1) s = s.slice(0, cfg);
  return s.replace(/\.$/, '');
}

/** Coerce a datapoint value (possibly wrapped in an array) to a number. */
export function toNumber(raw: unknown): number {
  if (Array.isArray(raw)) return toNumber(raw[0]);
  return Number(raw);
}
