// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Import" of the "Add a symbol" wizard (winccoa-fra-msp-stma#338): one or several symbols read from a
 * JSON text — a file's content or pasted, as Node-RED imports — checked before anything is added.
 *
 * Accepted:
 *  - one symbol (a `MachineDef`, as the symbol dialog exports it);
 *  - a list of symbols;
 *  - the `machine-fleet-symbols` file a workcenter exports (winccoa-fra-msp-stma#337):
 *    `{ format, version, exportedAt?, source?, mappings?, symbols }`, its state mappings added to the atelier
 *    when it has none of that id.
 *
 * An added symbol is placed by the atelier ("à placer", as any symbol of the wizard). A symbol whose id is
 * already in the atelier is a conflict: the user replaces it or skips it; a replacement keeps the position of the
 * one in place.
 * No dependency (tested by symbol-import.spec.ts).
 */
import type { MachineDef, StateMapping } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { MACHINE_TYPE_LABEL } from './machine-type-labels.js';
import { uniqueName } from './symbol-names.js';

/** The `format` of a workcenter's export (winccoa-fra-msp-stma#337). */
export const IMPORT_FORMAT = 'machine-fleet-symbols';
/** Highest version of that format this import reads. */
export const IMPORT_VERSION = 1;

/** Why a text is refused, with the 1-based number of the faulty symbol when it is one. */
export type ImportError =
  | { reason: 'empty' }
  | { reason: 'json'; detail: string }
  | { reason: 'format'; detail: string }
  | { reason: 'version'; detail: string }
  | { reason: 'noSymbol' }
  | { reason: 'symbol'; index: number; detail: 'notObject' | 'name' | 'type' | 'duplicate'; value?: string };

export interface ImportSource {
  kind?: string;
  code?: string;
  label?: string;
}

export type ImportResult =
  | { ok: true; symbols: MachineDef[]; mappings: StateMapping[]; source: ImportSource | null }
  | ({ ok: false } & ImportError);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KNOWN_TYPES = new Set(Object.keys(MACHINE_TYPE_LABEL));

/** One symbol of the text, checked; its representation `cabinet` when it gives none. */
function readSymbol(raw: unknown, index: number): MachineDef | ImportError {
  if (!isObject(raw)) return { reason: 'symbol', index, detail: 'notObject' };
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
  if (!name) return { reason: 'symbol', index, detail: 'name' };
  const type = raw['type'] === undefined ? 'cabinet' : raw['type'];
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return { reason: 'symbol', index, detail: 'type', value: String(type) };
  const def = { ...raw, name, type, id: typeof raw['id'] === 'string' ? raw['id'].trim() : '' } as unknown as MachineDef;
  // Without both coordinates, the atelier places it.
  if (typeof raw['x'] !== 'number' || typeof raw['z'] !== 'number') {
    def.x = 0;
    def.z = 0;
    def.toPlace = true;
  }
  if (typeof def.state !== 'string') def.state = 'ok';
  return def;
}

/** A state mapping of the file: the fields the atelier needs, else the file is refused. */
function isMapping(m: unknown): m is StateMapping {
  return isObject(m) && typeof m['id'] === 'string' && m['id'] !== '' && typeof m['name'] === 'string'
    && Array.isArray(m['rules']) && typeof m['fallback'] === 'string';
}

/** The symbols (and state mappings) of a JSON text, or why it is refused. Nothing is added here. */
export function parseSymbolImport(text: string): ImportResult {
  const src = text.trim();
  if (!src) return { ok: false, reason: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(src);
  } catch (e) {
    return { ok: false, reason: 'json', detail: e instanceof Error ? e.message : String(e) };
  }
  let rawSymbols: unknown[];
  let mappings: StateMapping[] = [];
  let source: ImportSource | null = null;
  if (Array.isArray(data)) {
    rawSymbols = data;
  } else if (isObject(data) && data['format'] !== undefined) {
    if (data['format'] !== IMPORT_FORMAT) return { ok: false, reason: 'format', detail: String(data['format']) };
    const version = data['version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > IMPORT_VERSION) {
      return { ok: false, reason: 'version', detail: String(version) };
    }
    if (!Array.isArray(data['symbols'])) return { ok: false, reason: 'format', detail: 'symbols' };
    rawSymbols = data['symbols'];
    const rawMappings = data['mappings'] ?? [];
    if (!Array.isArray(rawMappings) || !rawMappings.every(isMapping)) return { ok: false, reason: 'format', detail: 'mappings' };
    mappings = rawMappings;
    if (isObject(data['source'])) {
      const s = data['source'];
      source = {
        ...(typeof s['kind'] === 'string' ? { kind: s['kind'] } : {}),
        ...(typeof s['code'] === 'string' ? { code: s['code'] } : {}),
        ...(typeof s['label'] === 'string' ? { label: s['label'] } : {})
      };
    }
  } else {
    rawSymbols = [data];
  }
  if (rawSymbols.length === 0) return { ok: false, reason: 'noSymbol' };
  const symbols: MachineDef[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of rawSymbols.entries()) {
    const def = readSymbol(raw, i + 1);
    if ('reason' in def) return { ok: false, ...def };
    if (def.id) {
      if (ids.has(def.id)) return { ok: false, reason: 'symbol', index: i + 1, detail: 'duplicate', value: def.id };
      ids.add(def.id);
    }
    symbols.push(def);
  }
  return { ok: true, symbols, mappings, source };
}

/** The symbol of the atelier an imported one would replace (same id), or null. */
export function conflictOf(def: MachineDef, existing: readonly MachineDef[]): MachineDef | null {
  return def.id ? (existing.find((m) => m.id === def.id) ?? null) : null;
}

/** Fields of the symbol in place that a replacement keeps: where it is, and whether it is still to place. */
const POSITION_FIELDS = ['x', 'y', 'z', 'rotationY', 'markerId', 'bubbleOffset', 'toPlace'] as const;

/** The imported symbol replacing the one in place: its definition, at the position of the one it replaces. */
export function replacement(current: MachineDef, incoming: MachineDef): MachineDef {
  const out = { ...incoming, id: current.id } as MachineDef & Record<string, unknown>;
  for (const f of POSITION_FIELDS) {
    if (current[f] === undefined) delete out[f];
    else out[f] = current[f] as never;
  }
  return out;
}

/** The atelier's state mappings with those of the file it does not have (same id: the atelier's is kept). */
export function mergeMappings(current: readonly StateMapping[], incoming: readonly StateMapping[]): { mappings: StateMapping[]; added: number } {
  const ids = new Set(current.map((m) => m.id));
  const add = incoming.filter((m) => !ids.has(m.id) && ids.add(m.id));
  return { mappings: [...current, ...add.map((m) => structuredClone(m))], added: add.length };
}

/** What an import adds to an atelier: new symbols, symbols replacing those of the same id, state mappings. */
export interface SymbolImportPlan {
  add: MachineDef[];
  replace: MachineDef[];
  mappings: StateMapping[];
}

/**
 * The atelier after an import: the replaced symbols at their position, the new ones with the id of the file
 * (a workcenter's machine, found again by a later import) or `machine-<stamp>-<n>`, "à placer" at the centre
 * of the floor and bound to no marker; every name unique in the atelier (#276, the first free « (n) »); the
 * file's state mappings the atelier lacks added. `focus`: the first symbol added, else the first replaced.
 */
export function applyImport(
  machines: readonly MachineDef[],
  mappings: readonly StateMapping[],
  imp: SymbolImportPlan,
  stamp: number
): { machines: MachineDef[]; mappings: StateMapping[]; mappingsAdded: number; focus: string | null } {
  const merged = mergeMappings(mappings, imp.mappings);
  const byId = new Map(imp.replace.map((d) => [d.id, d]));
  let out = machines.map((m) => {
    const incoming = byId.get(m.id);
    return incoming ? replacement(m, incoming) : m;
  });
  // Each replaced symbol's name checked against all the others, one after the other.
  for (const id of byId.keys()) {
    const i = out.findIndex((m) => m.id === id);
    if (i < 0) continue;
    const name = uniqueName(out[i].name, out.filter((_, j) => j !== i));
    out = out.map((m, j) => (j === i ? { ...m, name } : m));
  }
  let focus: string | null = null;
  for (const [n, src] of imp.add.entries()) {
    const id = src.id && !out.some((m) => m.id === src.id) ? src.id : `machine-${stamp}-${n}`;
    const def: MachineDef = { ...src, id, name: uniqueName(src.name, out), x: 0, z: 0, toPlace: true };
    delete def.markerId;
    delete def.bubbleOffset;
    out = [...out, def];
    focus ??= id;
  }
  focus ??= imp.replace.find((d) => out.some((m) => m.id === d.id))?.id ?? null;
  return { machines: out, mappings: merged.mappings, mappingsAdded: merged.added, focus };
}
