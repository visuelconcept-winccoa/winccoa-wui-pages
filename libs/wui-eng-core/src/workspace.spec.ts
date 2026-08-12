// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Workspace housekeeping: taking staged objects back out.
 *
 * The case that forced it: a model deleted from the library left its generated type and
 * its 24 datapoints staged for creation, the Control tab kept offering to create them,
 * and there was no way to clean up. What each test guards is that "forget" is about the
 * workspace's CLAIM and never about the live project — including the trap that removing
 * an object without its baseline key turns a pending creation into a pending DELETION.
 */
import { describe, expect, it } from 'vitest';
import { baselineOf, diffWorkspace } from './diff.js';
import { dpOfDpe, forgetInWorkspace, orphanStagedDps } from './workspace.js';
import type { EngType, LiveSnapshot, Workspace } from './model.js';

const FOUR: EngType = {
  typeName: 'Equip_Four',
  structure: { name: 'Equip_Four', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }] }
};
const POMPE: EngType = {
  typeName: 'Equip_Pompe',
  structure: { name: 'Equip_Pompe', type: 'Struct', children: [{ name: 'Marche', type: 'Bool' }] }
};

function workspace(partial: Partial<Workspace> = {}): Workspace {
  return {
    name: 'ws1',
    types: [FOUR, POMPE],
    dps: [
      { dpName: 'Z01_FOUR001', dpType: 'Equip_Four' },
      { dpName: 'Z01_FOUR002', dpType: 'Equip_Four' },
      { dpName: 'Z01_POMPE1', dpType: 'Equip_Pompe' }
    ],
    configs: {
      'Z01_FOUR001.Temperature': { range: { min: 0, max: 450, inclMin: true, inclMax: true } },
      'Z01_FOUR002.Temperature': { range: { min: 0, max: 450, inclMin: true, inclMax: true } },
      'Z01_POMPE1.Marche': { alarm: { kind: 'binary', direction: 'came', className: 'alert.' } }
    },
    baseline: {},
    ...partial
  };
}

const NO_LIVE: LiveSnapshot = { types: [], dps: [], configs: {} };

describe('forgetInWorkspace', () => {
  it('cancels a staged creation: the object simply leaves the plan', () => {
    const { workspace: cleaned } = forgetInWorkspace(workspace(), { dps: ['Z01_FOUR002'] });
    const plan = diffWorkspace(cleaned, NO_LIVE);
    expect(plan.items.map((item) => item.name)).not.toContain('Z01_FOUR002');
    // Everything else is still staged — housekeeping is not a reset.
    expect(plan.items.map((item) => item.name)).toContain('Z01_FOUR001');
  });

  it('takes a datapoint CONFIGS with it — a config on a DPE that will not exist is noise', () => {
    const { workspace: cleaned, removed } = forgetInWorkspace(workspace(), { dps: ['Z01_FOUR002'] });
    expect(Object.keys(cleaned.configs)).not.toContain('Z01_FOUR002.Temperature');
    expect(removed.configs).toEqual(['Z01_FOUR002.Temperature']);
  });

  it('cascades a TYPE to its datapoints and their configs, and reports the counts', () => {
    const { workspace: cleaned, removed } = forgetInWorkspace(workspace(), { types: ['Equip_Four'] });
    expect(cleaned.types.map((type) => type.typeName)).toEqual(['Equip_Pompe']);
    expect(cleaned.dps.map((dp) => dp.dpName)).toEqual(['Z01_POMPE1']);
    expect(Object.keys(cleaned.configs)).toEqual(['Z01_POMPE1.Marche']);
    expect(removed).toEqual({
      types: ['Equip_Four'],
      dps: ['Z01_FOUR001', 'Z01_FOUR002'],
      configs: ['Z01_FOUR001.Temperature', 'Z01_FOUR002.Temperature']
    });
  });

  /**
   * The trap this function exists to avoid. A checked-out object that leaves the
   * workspace while its BASELINE key stays reads, to the diff engine, as "the operator
   * deleted it deliberately" — so cleaning up a pending change would queue a deletion in
   * the live project. The opposite of housekeeping.
   */
  it('drops the BASELINE with the object, so cleaning up never queues a live deletion', () => {
    const live: LiveSnapshot = {
      types: [FOUR],
      dps: [{ dpName: 'Z01_FOUR001', dpType: 'Equip_Four' }],
      configs: {}
    };
    const checkedOut = workspace({ baseline: baselineOf(live) });
    // Sanity: without the baseline drop this is what would happen.
    const naive = { ...checkedOut, dps: checkedOut.dps.filter((dp) => dp.dpName !== 'Z01_FOUR001') };
    expect(diffWorkspace(naive, live).items.map((item) => `${item.op}:${item.name}`)).toContain('delete:Z01_FOUR001');
    // With it: the workspace simply stops talking about the datapoint.
    const { workspace: cleaned } = forgetInWorkspace(checkedOut, { dps: ['Z01_FOUR001'] });
    expect(diffWorkspace(cleaned, live).items.map((item) => item.name)).not.toContain('Z01_FOUR001');
  });

  it('calls a pending DELETION off (that is a baseline entry, nothing else)', () => {
    const live: LiveSnapshot = { types: [FOUR], dps: [{ dpName: 'Z01_OLD', dpType: 'Equip_Four' }], configs: {} };
    // Checked out, then removed from the workspace by hand → the plan says delete.
    const ws = workspace({ dps: [], baseline: baselineOf(live) });
    expect(diffWorkspace(ws, live).items.map((item) => `${item.op}:${item.name}`)).toContain('delete:Z01_OLD');
    const { workspace: cleaned } = forgetInWorkspace(ws, { dps: ['Z01_OLD'] });
    expect(diffWorkspace(cleaned, live).items.map((item) => item.name)).not.toContain('Z01_OLD');
  });

  it('never mutates the workspace it was given (a failed save must not half-clean it)', () => {
    const original = workspace();
    const snapshot = JSON.stringify(original);
    forgetInWorkspace(original, { types: ['Equip_Four'], dps: ['Z01_POMPE1'] });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('is a no-op on an empty selection', () => {
    const original = workspace();
    const { workspace: cleaned, removed } = forgetInWorkspace(original, {});
    expect(cleaned).toEqual(original);
    expect(removed).toEqual({ types: [], dps: [], configs: [] });
  });
});

describe('orphanStagedDps', () => {
  it('names the datapoints whose DP type exists NOWHERE — what a deleted model leaves', () => {
    const ws = workspace({ types: [POMPE] }); // Equip_Four deleted from the workspace
    expect(orphanStagedDps(ws, NO_LIVE)).toEqual(['Z01_FOUR001', 'Z01_FOUR002']);
  });

  it('is silent when the type is in the workspace, or already in the project', () => {
    expect(orphanStagedDps(workspace(), NO_LIVE)).toEqual([]);
    const ws = workspace({ types: [POMPE] });
    const live: LiveSnapshot = { types: [FOUR], dps: [], configs: {} };
    expect(orphanStagedDps(ws, live)).toEqual([]);
  });

  it('says so in the PLAN, with the names — the Control tab is where it can be fixed', () => {
    const plan = diffWorkspace(workspace({ types: [POMPE] }), NO_LIVE);
    const warning = plan.warnings.find((item) => item.code === 'diff.dp-type-missing');
    expect(warning?.params).toMatchObject({ n: 2, dps: 'Z01_FOUR001, Z01_FOUR002' });
  });

  it('ignores an existing datapoint (nothing is staged for creation there)', () => {
    const live: LiveSnapshot = { types: [], dps: [{ dpName: 'Z01_FOUR001', dpType: 'Equip_Four' }], configs: {} };
    expect(orphanStagedDps(workspace({ types: [POMPE] }), live)).toEqual(['Z01_FOUR002']);
  });
});

describe('dpOfDpe', () => {
  it('takes the datapoint out of a DPE path, trailing-dot notation included', () => {
    expect(dpOfDpe('Z01_FOUR001.Temperature')).toBe('Z01_FOUR001');
    expect(dpOfDpe('Z01_FOUR001.Etat.Marche')).toBe('Z01_FOUR001');
    expect(dpOfDpe('Z01_FOUR001.')).toBe('Z01_FOUR001');
    expect(dpOfDpe('Z01_FOUR001')).toBe('Z01_FOUR001');
  });
});
