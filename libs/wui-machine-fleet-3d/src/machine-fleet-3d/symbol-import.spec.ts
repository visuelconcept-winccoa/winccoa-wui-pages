// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import of the "Add a symbol" wizard (winccoa-fra-msp-stma#338): one symbol, a list, or a workcenter's export
 * (#337), checked before anything is added; conflicts by id, replacement keeping the position.
 */
import { describe, expect, it } from 'vitest';
import type { MachineDef, StateMapping } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { IMPORT_FORMAT, applyImport, conflictOf, mergeMappings, parseSymbolImport, replacement } from './symbol-import.js';

const MAPPING: StateMapping = { id: 'wc-categorie', name: 'États du MES', rules: [{ state: 'ok', min: 0, max: 0 }], fallback: 'stop' };
const sym = (over: Partial<MachineDef> = {}): MachineDef => ({ id: 'CN_01', name: 'CN 01', type: 'cabinet', x: 4, z: 7, state: 'ok', ...over });

describe('symbol import — reading', () => {
  it('one symbol, as the symbol dialog exports it, keeps its position', () => {
    const r = parseSymbolImport(JSON.stringify(sym({ stateDp: 'CN_01.State' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0]).toMatchObject({ id: 'CN_01', name: 'CN 01', x: 4, z: 7, stateDp: 'CN_01.State' });
    expect(r.symbols[0].toPlace).toBeUndefined();
    expect(r.mappings).toEqual([]);
  });

  it('a list of symbols, each without position placed by the atelier', () => {
    const r = parseSymbolImport(JSON.stringify([{ name: ' A ' }, { id: 'B', name: 'B', type: 'glb' }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbols.map((s) => [s.id, s.name, s.type, s.x, s.z, s.toPlace, s.state])).toEqual([
      ['', 'A', 'cabinet', 0, 0, true, 'ok'],
      ['B', 'B', 'glb', 0, 0, true, 'ok']
    ]);
  });

  it('the export of a workcenter (#337), with its state mappings and its source', () => {
    const file = {
      format: IMPORT_FORMAT, version: 1, exportedAt: '2026-11-13T15:30:00.000Z',
      source: { kind: 'workcenter', code: 'ILOT_CN', label: 'Îlot CN' },
      mappings: [MAPPING],
      symbols: [{ id: 'CN_01', name: 'Centre CN 01', stateMappingId: 'wc-categorie', kpis: [{ key: 'ctx.article', label: 'Article', dp: 'WC_ILOT_CN.Context.Article' }] }]
    };
    const r = parseSymbolImport(`\n${JSON.stringify(file, null, 2)}\n`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toEqual({ kind: 'workcenter', code: 'ILOT_CN', label: 'Îlot CN' });
    expect(r.mappings).toEqual([MAPPING]);
    expect(r.symbols[0]).toMatchObject({ id: 'CN_01', type: 'cabinet', toPlace: true, stateMappingId: 'wc-categorie' });
  });

  it('refused, with the reason, before anything is added', () => {
    expect(parseSymbolImport('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseSymbolImport('{ name: ').ok).toBe(false);
    expect((parseSymbolImport('{ name: ') as { reason: string }).reason).toBe('json');
    expect(parseSymbolImport('[]')).toEqual({ ok: false, reason: 'noSymbol' });
    expect(parseSymbolImport(JSON.stringify({ format: 'node-red', version: 1, symbols: [] }))).toEqual({ ok: false, reason: 'format', detail: 'node-red' });
    expect(parseSymbolImport(JSON.stringify({ format: IMPORT_FORMAT, version: 2, symbols: [] }))).toEqual({ ok: false, reason: 'version', detail: '2' });
    expect(parseSymbolImport(JSON.stringify({ format: IMPORT_FORMAT, version: 1 }))).toEqual({ ok: false, reason: 'format', detail: 'symbols' });
    expect(parseSymbolImport(JSON.stringify({ format: IMPORT_FORMAT, version: 1, mappings: [{ id: 'x' }], symbols: [{ name: 'A' }] })))
      .toEqual({ ok: false, reason: 'format', detail: 'mappings' });
    expect(parseSymbolImport(JSON.stringify([{ name: 'A' }, 3]))).toEqual({ ok: false, reason: 'symbol', index: 2, detail: 'notObject' });
    expect(parseSymbolImport(JSON.stringify([{ name: '' }]))).toEqual({ ok: false, reason: 'symbol', index: 1, detail: 'name' });
    expect(parseSymbolImport(JSON.stringify([{ name: 'A', type: 'pompe' }]))).toEqual({ ok: false, reason: 'symbol', index: 1, detail: 'type', value: 'pompe' });
    expect(parseSymbolImport(JSON.stringify([{ id: 'M', name: 'A' }, { id: 'M', name: 'B' }]))).toEqual({ ok: false, reason: 'symbol', index: 2, detail: 'duplicate', value: 'M' });
  });
});

describe('symbol import — adding to an atelier', () => {
  it('a symbol whose id is in the atelier is a conflict; one without id never is', () => {
    const atelier = [sym(), sym({ id: 'M2', name: 'Four' })];
    expect(conflictOf(sym({ x: 0 }), atelier)?.name).toBe('CN 01');
    expect(conflictOf(sym({ id: 'X' }), atelier)).toBeNull();
    expect(conflictOf(sym({ id: '' }), atelier)).toBeNull();
  });

  it('a replacement takes the imported definition at the position of the symbol in place', () => {
    const current = sym({ x: 12, z: -3, y: 1, rotationY: 90, markerId: 'p1', bubbleOffset: [5, -40], type: 'glb', glbUrl: 'dp:MachineFleet3D_Glb_a' });
    const incoming = sym({ name: 'Centre CN 01', x: 0, z: 0, toPlace: true, stateDp: 'X.State' });
    const r = replacement(current, incoming);
    expect(r).toMatchObject({ id: 'CN_01', name: 'Centre CN 01', stateDp: 'X.State', x: 12, z: -3, y: 1, rotationY: 90, markerId: 'p1', bubbleOffset: [5, -40] });
    expect(r.toPlace).toBeUndefined();
    expect(r.type).toBe('cabinet');
    expect(r.glbUrl).toBeUndefined();
    expect(replacement(sym({ toPlace: true }), sym({ id: 'other' })).id).toBe('CN_01');
  });

  it('state mappings of the file added when the atelier has none of their id', () => {
    const mine: StateMapping = { ...MAPPING, name: 'Mienne' };
    expect(mergeMappings([mine], [MAPPING, { ...MAPPING, id: 'autre' }])).toEqual({ mappings: [mine, { ...MAPPING, id: 'autre' }], added: 1 });
    expect(mergeMappings([], [MAPPING, MAPPING]).added).toBe(1);
  });

  it('applied to an atelier: replaced in place, added « à placer » with the id of the file, names unique, mappings added', () => {
    const atelier = [sym({ x: 9, z: 9, markerId: 'p1' }), sym({ id: 'M2', name: 'Four' }), sym({ id: 'M3', name: 'Presse' })];
    const imp = {
      replace: [sym({ name: 'Presse', x: 0, z: 0, stateDp: 'NEW.State' })],
      add: [sym({ id: 'FR_01', name: 'Four', x: 3, z: 3, markerId: 'p2' }), sym({ id: 'M2', name: 'Copie' }), sym({ id: '', name: 'Sans id' })],
      mappings: [MAPPING]
    };
    const r = applyImport(atelier, [], imp, 77);
    expect(r.mappingsAdded).toBe(1);
    expect(r.mappings).toEqual([MAPPING]);
    const cn = r.machines.find((m) => m.id === 'CN_01');
    expect(cn).toMatchObject({ x: 9, z: 9, markerId: 'p1', stateDp: 'NEW.State', name: 'Presse (2)' });
    const added = r.machines.slice(3);
    expect(added.map((m) => [m.id, m.name, m.x, m.z, m.toPlace, m.markerId])).toEqual([
      ['FR_01', 'Four (2)', 0, 0, true, undefined],
      ['machine-77-1', 'Copie', 0, 0, true, undefined],
      ['machine-77-2', 'Sans id', 0, 0, true, undefined]
    ]);
    expect(r.focus).toBe('FR_01');
    expect(atelier[0].stateDp).toBeUndefined();
  });

  it('applied with nothing to add: only the replaced, focused', () => {
    const r = applyImport([sym()], [MAPPING], { add: [], replace: [sym({ name: 'CN neuf' })], mappings: [MAPPING] }, 1);
    expect(r.machines.map((m) => [m.id, m.name, m.x])).toEqual([['CN_01', 'CN neuf', 4]]);
    expect([r.mappingsAdded, r.focus]).toEqual([0, 'CN_01']);
    expect(applyImport([sym()], [], { add: [], replace: [], mappings: [] }, 1).focus).toBeNull();
  });
});
