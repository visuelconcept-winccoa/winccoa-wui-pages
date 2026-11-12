// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure logic of `wui-dp-input`: what the typed text asks for (datapoints, the elements of one, or the
 * datapoint types), the next-level elements of a path, the highlighted part of a suggestion and the
 * shape of a value. `dpNames` patterns: `*` stays within one level of a path (`DP.*` lists the
 * elements right under DP), `**` goes through every level. Tested by dp-input-logic.spec.ts.
 */

/** Suggestions shown at most; past it the list says it is cut. */
export const MAX_SUGGESTIONS = 40;

/** What the typed text asks for. */
export type DpQuery =
  /** No text: the datapoint types (browse button). */
  | { kind: 'types' }
  /** A datapoint name (no `.` yet): `dpNames(pattern)`. */
  | { kind: 'dp'; pattern: string; typed: string }
  /** The elements right under `base`, those containing `partial`. */
  | { kind: 'element'; base: string; partial: string };

/** "System1:Name.el" → "Name.el" (display only: the value keeps its system). */
export function withoutSystem(name: string): string {
  const m = /^[A-Za-z][A-Za-z0-9_]*:(?!_)/.exec(name);
  return m ? name.slice(m[0].length) : name;
}

/** A datapoint element without its config part ("DP.el:_online.._value" → "DP.el"). */
export function withoutConfig(dpe: string): string {
  const sys = /^[A-Za-z][A-Za-z0-9_]*:(?!_)/.exec(dpe)?.[0] ?? '';
  const rest = dpe.slice(sys.length);
  const at = rest.indexOf(':');
  return sys + (at < 0 ? rest : rest.slice(0, at));
}

/** What the text asks for: the types when empty, a datapoint until a `.`, then the elements of the path. */
export function parseQuery(text: string): DpQuery {
  const t = withoutConfig(text.trim());
  if (t === '') return { kind: 'types' };
  const dot = t.lastIndexOf('.');
  if (dot < 0) return { kind: 'dp', pattern: t.includes('*') ? t : `*${t}*`, typed: withoutSystem(t).replace(/\*/g, '') };
  return { kind: 'element', base: t.slice(0, dot), partial: t.slice(dot + 1) };
}

/** A suggested element: its full name, its own segment, and whether it has elements under it. */
export interface ChildElement {
  name: string;
  segment: string;
  hasChildren: boolean;
}

/**
 * The elements right under `base` (from `dpNames(base + '.*')`), those containing `partial` (case
 * ignored), each told whether it has elements under it (from `dpNames(base + '.*.*')`). The root
 * element `DP.` that `dpNames` may list is left out.
 */
export function childElements(base: string, children: readonly string[], grandchildren: readonly string[], partial = ''): ChildElement[] {
  const parents = new Set(grandchildren.map((g) => g.slice(0, g.lastIndexOf('.'))));
  const want = partial.toLowerCase();
  const prefix = `${base}.`;
  const out: ChildElement[] = [];
  for (const name of children) {
    const rest = name.startsWith(prefix) ? name.slice(prefix.length) : name.slice(name.lastIndexOf('.') + 1);
    if (rest === '' || rest.includes('.')) continue;
    if (want && !rest.toLowerCase().includes(want)) continue;
    out.push({ name, segment: rest, hasChildren: parents.has(name) });
  }
  return out;
}

/** A label split around the first occurrence of `typed` (case ignored), for showing it in bold. */
export function highlight(label: string, typed: string): { before: string; match: string; after: string } {
  const at = typed ? label.toLowerCase().indexOf(typed.toLowerCase()) : -1;
  if (at < 0) return { before: label, match: '', after: '' };
  return { before: label.slice(0, at), match: label.slice(at, at + typed.length), after: label.slice(at + typed.length) };
}

/** The parent level of an element path ("DP.a.b" → "DP.a."), or the datapoint name for a top element. */
export function parentOf(base: string): { value: string; atDp: boolean } {
  const dot = base.lastIndexOf('.');
  return dot < 0 ? { value: base, atDp: true } : { value: `${base.slice(0, dot)}.`, atDp: false };
}

/** The name `dpNames` must find for a value to exist: no config part, a top-level `DP.` → `DP`. */
export function existenceName(value: string): string {
  const v = withoutConfig(value.trim());
  return v.endsWith('.') ? v.slice(0, -1) : v;
}

/** A current value, short: numbers in the French way, long text cut, lists counted. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) return `[${v.length}]`;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}

/** A description worth showing: not empty, not just the element's own name. */
export function usefulDescription(description: unknown, name: string): string {
  const d = typeof description === 'string' ? description.trim() : '';
  if (d === '' || d === name || withoutSystem(d) === withoutSystem(name) || d === `${withoutSystem(name)}.`) return '';
  return d;
}
