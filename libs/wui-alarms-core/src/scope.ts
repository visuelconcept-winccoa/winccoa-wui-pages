// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datapoint scoping — how an embedded alarm view says "only MY alarms".
 *
 * Scoping is CLIENT-SIDE by design. `AlertService.connect(filter)` forwards its
 * filter to the backend, which rejects glob patterns (see the wui-alert-data
 * README), and a page that embeds several scoped views would otherwise open one
 * server subscription per scope instead of sharing the single cached one. So the
 * kit subscribes once, unfiltered, and every view narrows the same stream.
 *
 * A scope entry is either a glob (`Line1_*.state`) or a plain name. A plain name
 * matches the datapoint element itself AND everything under it, so a machine
 * bound to `System1:Press01.state` can be scoped with just `Press01`.
 */
import type { Alarm } from './types.js';

/** Characters to escape when a glob is turned into a regular expression. */
const REGEXP_SPECIALS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/** `System1:Pump1.value` → `{ system: 'System1', dp: 'Pump1', element: 'value' }`. */
export function splitDpe(dpe: string): { system: string; dp: string; element: string } {
  const colon = dpe.indexOf(':');
  const system = colon === -1 ? '' : dpe.slice(0, colon);
  const rest = colon === -1 ? dpe : dpe.slice(colon + 1);
  const dot = rest.indexOf('.');
  return {
    system,
    dp: dot === -1 ? rest : rest.slice(0, dot),
    element: dot === -1 ? '' : rest.slice(dot + 1)
  };
}

/** The datapoint element without its system prefix (`Pump1.value`). */
export function bareDpe(dpe: string): string {
  const colon = dpe.indexOf(':');
  return colon === -1 ? dpe : dpe.slice(colon + 1);
}

/** A WinCC OA style glob (`*`, `?`) as an anchored, case-insensitive regexp. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += REGEXP_SPECIALS.has(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`, 'i');
}

/** True when `dpe` is in the scope entry (exact, subtree, or glob). */
export function matchesScopeEntry(dpe: string, entry: string): boolean {
  const needle = entry.trim();
  if (needle === '' || needle === '*') return true;
  const candidates = [dpe, bareDpe(dpe)];
  if (needle.includes('*') || needle.includes('?')) {
    const pattern = globToRegExp(needle);
    // A glob over datapoint NAMES (`Press0?`) must reach that datapoint's elements
    // too, exactly like a plain name does.
    const { system, dp } = splitDpe(dpe);
    const widened = needle.includes('.') ? candidates : [...candidates, dp, `${system}:${dp}`];
    return widened.some((candidate) => pattern.test(candidate));
  }
  const bareNeedle = bareDpe(needle);
  return candidates.some(
    (candidate) =>
      candidate === needle ||
      candidate === bareNeedle ||
      candidate.startsWith(`${needle}.`) ||
      candidate.startsWith(`${bareNeedle}.`)
  );
}

/** True when the alarm is inside the scope. An empty scope means "everything". */
export function inScope(alarm: Pick<Alarm, 'dpe'>, scope?: readonly string[]): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.some((entry) => matchesScopeEntry(alarm.dpe, entry));
}

/**
 * The alarm scope of a set of bound datapoint elements — the machine case.
 *
 * A machine binds `System1:Press01.state`, `System1:Press01.temp`, … and its
 * alarms may sit on any element of `Press01`, including ones the machine does
 * not read. Scoping on the DATAPOINTS (not the elements) is therefore the useful
 * reading of "this machine's alarms".
 */
export function scopeFromDpes(dpes: readonly (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const dpe of dpes) {
    if (typeof dpe !== 'string' || dpe.trim() === '') continue;
    const { system, dp } = splitDpe(dpe.trim());
    if (dp === '') continue;
    out.add(system === '' ? dp : `${system}:${dp}`);
  }
  return [...out];
}

/** Parse the comma / semicolon / space separated `dps` attribute of the view. */
export function parseScopeAttribute(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * The scope carried by a route's query string — `?dp=System1%3APress01`.
 *
 * Takes the **search string the router resolved**, not a datapoint name, because that is what
 * a page receives from its router and because the decoding matters: a drill-down link
 * percent-encodes the `:` of the system prefix (`System1%3AGisSim_x`), and a scope entry
 * compared with the `%3A` still in it matches nothing at all. `URLSearchParams` does that
 * decoding; hand-splitting on `=` does not.
 *
 * Accepts the string with or without its leading `?`, and no `dp` at all (⇒ no scope, which
 * the caller reads as "the whole system").
 */
export function scopeFromSearch(search: string): string[] {
  const parameters = new URLSearchParams(search);
  return parseScopeAttribute(parameters.get('dp') ?? '');
}
