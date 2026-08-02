// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Check-in diff semantics: create/update, deliberate deletes only (baseline
 * required), conflicts when the live project drifted since check-out, and the
 * deterministic types → dps → configs order.
 */
import { describe, expect, it } from 'vitest';
import { baselineOf, diffWorkspace } from './diff.js';
import { fingerprint, type EngType, type LiveSnapshot, type Workspace } from './model.js';

const TYPE_A: EngType = {
  typeName: 'Equip_Four',
  structure: { name: 'Equip_Four', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] }
};

function emptySnapshot(): LiveSnapshot {
  return { types: [], dps: [], configs: {} };
}

function workspace(partial: Partial<Workspace>): Workspace {
  return { name: 'ws1', types: [], dps: [], configs: {}, baseline: {}, ...partial };
}

describe('diffWorkspace', () => {
  it('plans creates for new types, dps and configs', () => {
    const ws = workspace({
      types: [TYPE_A],
      dps: [{ dpName: 'Z01_FOUR001', dpType: 'Equip_Four' }],
      configs: { 'Z01_FOUR001.Temperature': { range: { min: 0, max: 450, inclMin: true, inclMax: true } } }
    });
    const plan = diffWorkspace(ws, emptySnapshot());
    expect(plan.items.map((i) => `${i.kind}:${i.op}:${i.name}`)).toEqual([
      'type:create:Equip_Four',
      'dp:create:Z01_FOUR001',
      'config:create:Z01_FOUR001.Temperature'
    ]);
  });

  it('plans an update when a checked-out type changed in the workspace', () => {
    const live: LiveSnapshot = { types: [TYPE_A], dps: [], configs: {} };
    const ws = workspace({
      types: [
        {
          typeName: 'Equip_Four',
          structure: {
            name: 'Equip_Four',
            type: 'Struct',
            children: [
              { name: 'Temperature', type: 'Float' },
              { name: 'Hygrometrie', type: 'Float' }
            ]
          }
        }
      ],
      baseline: baselineOf(live)
    });
    const plan = diffWorkspace(ws, live);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ kind: 'type', op: 'update', name: 'Equip_Four', conflict: undefined });
  });

  it('never deletes live objects that were not checked out', () => {
    const live: LiveSnapshot = { types: [TYPE_A], dps: [{ dpName: 'Autre_DP', dpType: 'Equip_Four' }], configs: {} };
    const plan = diffWorkspace(workspace({}), live);
    expect(plan.items).toHaveLength(0);
  });

  it('plans a delete when a checked-out object was removed from the workspace', () => {
    const live: LiveSnapshot = { types: [TYPE_A], dps: [], configs: {} };
    const ws = workspace({ baseline: baselineOf(live) }); // type checked out, then removed
    const plan = diffWorkspace(ws, live);
    expect(plan.items).toEqual([
      expect.objectContaining({ kind: 'type', op: 'delete', name: 'Equip_Four' })
    ]);
  });

  it('flags a conflict when the live object drifted since check-out', () => {
    const checkedOut: LiveSnapshot = { types: [TYPE_A], dps: [], configs: {} };
    const ws = workspace({
      types: [
        {
          typeName: 'Equip_Four',
          structure: { name: 'Equip_Four', type: 'Struct', children: [{ name: 'Temperature', type: 'Int' }] }
        }
      ],
      baseline: baselineOf(checkedOut)
    });
    const drifted: LiveSnapshot = {
      types: [
        {
          typeName: 'Equip_Four',
          structure: { name: 'Equip_Four', type: 'Struct', children: [{ name: 'Pression', type: 'Float' }] }
        }
      ],
      dps: [],
      configs: {}
    };
    const plan = diffWorkspace(ws, drifted);
    expect(plan.items[0].conflict).toBe(true);
  });

  it('summarises config family changes in the detail', () => {
    const live: LiveSnapshot = {
      types: [],
      dps: [],
      configs: { 'DP1.': { archive: { group: 'EVENT', active: true } } }
    };
    const ws = workspace({
      configs: {
        'DP1.': {
          archive: { group: 'EVENT', active: true },
          range: { min: 0, max: 100, inclMin: true, inclMax: true }
        }
      },
      baseline: baselineOf(live)
    });
    const plan = diffWorkspace(ws, live);
    expect(plan.items[0].detail).toBe('+range');
  });

  it('fingerprint is key-order independent (stable baselines)', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });
});
