// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model instances: derived from the workspace (never stored), and their check-in
 * status taken from the plan the page already computes.
 */
import { describe, expect, it } from 'vitest';
import { instanceTargets, modelInstances, modelStatus, tallyInstances } from './instances.js';
import type { EngPlan, LiveSnapshot, PlanItem, Workspace } from './model.js';

const workspace: Workspace = {
  name: 'ws',
  types: [
    { typeName: 'Equip_Four', structure: { name: 'Equip_Four', type: 'Struct', children: [{ name: 'Temp', type: 'Float' }] } },
    { typeName: 'Equip_Pompe', structure: { name: 'Equip_Pompe', type: 'Struct', children: [{ name: 'Marche', type: 'Bool' }] } }
  ],
  dps: [
    { dpName: 'FOUR001', dpType: 'Equip_Four' },
    { dpName: 'FOUR002', dpType: 'Equip_Four' },
    { dpName: 'POMPE001', dpType: 'Equip_Pompe' }
  ],
  configs: {
    'FOUR001.Temp': { address: { deviceId: 's7-four1', mode: 's7plus', reference: 'a', direction: 4, datatype: 760, active: true } },
    'FOUR002.Temp': { address: { deviceId: 's7-four2', mode: 's7plus', reference: 'b', direction: 4, datatype: 760, active: true } },
    // No address at all: the device is UNKNOWN, not "none".
    'POMPE001.Marche': { archive: { group: 'EVENT', active: true } }
  },
  baseline: {}
};

const item = (over: Partial<PlanItem>): PlanItem => ({ kind: 'config', op: 'update', name: 'x', ...over });
const plan = (items: PlanItem[]): EngPlan => ({ workspace: 'ws', items, warnings: [] });

describe('the status of a MODEL (its DP type)', () => {
  it('says "to create" for a type the project does not have', () => {
    // The bug this pins: the type item's `create` was folded into `update`, so a model whose DP
    // type does not exist announced "to update" next to "not created".
    const plan: EngPlan = {
      workspace: 'ws',
      warnings: [],
      items: [{ kind: 'type', op: 'create', name: 'FraDataloggerModel', payload: { typeName: 'FraDataloggerModel', structure: { name: 'FraDataloggerModel', type: 'Struct', children: [] } } }]
    };
    expect(modelStatus('FraDataloggerModel', plan)).toBe('create');
  });

  it('says "to update" for a type whose structure differs', () => {
    const plan: EngPlan = {
      workspace: 'ws',
      warnings: [],
      items: [{ kind: 'type', op: 'update', name: 'Equip_Four', payload: { typeName: 'Equip_Four', structure: { name: 'Equip_Four', type: 'Struct', children: [] } } }]
    };
    expect(modelStatus('Equip_Four', plan)).toBe('update');
  });
});

describe('instances of a model built on an EXISTING DP type', () => {
  /** The project has two datapoints of the type; the working copy describes neither. */
  const live: LiveSnapshot = {
    types: [{ typeName: 'AGV_Vehicle_Model', structure: { name: 'AGV_Vehicle_Model', type: 'Struct', children: [] } }],
    dps: [
      { dpName: 'AGV_02', dpType: 'AGV_Vehicle_Model' },
      { dpName: 'AGV_01', dpType: 'AGV_Vehicle_Model' }
    ],
    configs: {}
  };
  const empty: Workspace = { name: 'ws', types: [], dps: [], configs: {}, baseline: {} };

  it('LISTS the project datapoints the model does not describe yet', () => {
    const instances = modelInstances(empty, 'AGV_Vehicle_Model', null, live);
    // Sorted, both of them, and each one flagged for what it is: the project has it, the
    // model has not been applied to it.
    expect(instances.map((instance) => instance.dpName)).toEqual(['AGV_01', 'AGV_02']);
    expect(instances.every((instance) => instance.exists && !instance.managed)).toBe(true);
    expect(instances.every((instance) => instance.status === 'unmanaged')).toBe(true);
    expect(tallyInstances(instances)).toMatchObject({ total: 2, unmanaged: 2, synced: 0 });
  });

  it('merges the two sides without double-counting a datapoint both have', () => {
    const staged: Workspace = { ...empty, dps: [{ dpName: 'AGV_01', dpType: 'AGV_Vehicle_Model' }] };
    const instances = modelInstances(staged, 'AGV_Vehicle_Model', null, live);
    expect(instances.map((instance) => `${instance.dpName}:${instance.status}`)).toEqual([
      // Described by the model AND in the project, with nothing pending → in sync…
      'AGV_01:synced',
      // …and the one the model says nothing about, still listed.
      'AGV_02:unmanaged'
    ]);
    expect(instances[0].managed).toBe(true);
    expect(instances[1].managed).toBe(false);
  });
});

describe('modelInstances', () => {
  it('derives one instance per workspace datapoint of the model, with its device', () => {
    const instances = modelInstances(workspace, 'Equip_Four', null);
    expect(instances.map((i) => [i.dpName, i.deviceId])).toEqual([
      ['FOUR001', 's7-four1'],
      ['FOUR002', 's7-four2']
    ]);
    // Another model's datapoints are not instances of this one.
    expect(modelInstances(workspace, 'Equip_Pompe', null).map((i) => i.dpName)).toEqual(['POMPE001']);
  });

  it('leaves the device UNDEFINED when no address records one', () => {
    expect(modelInstances(workspace, 'Equip_Pompe', null)[0].deviceId).toBeUndefined();
  });

  it('reports synced when there is no plan — an unknown state is not a pending change', () => {
    expect(modelInstances(workspace, 'Equip_Four', null).every((i) => i.status === 'synced')).toBe(true);
  });

  it('takes each instance status from the plan items that concern IT', () => {
    const instances = modelInstances(
      workspace,
      'Equip_Four',
      plan([
        item({ kind: 'dp', op: 'create', name: 'FOUR002' }),
        item({ kind: 'config', op: 'update', name: 'FOUR001.Temp' }),
        // Another model's item must not colour these.
        item({ kind: 'config', op: 'create', name: 'POMPE001.Marche' })
      ])
    );
    expect(instances.map((i) => [i.dpName, i.status])).toEqual([
      ['FOUR001', 'update'],
      ['FOUR002', 'create']
    ]);
  });

  /**
   * "to create" is a statement about the DATAPOINT. An instance that exists live and
   * merely gains config families is being updated — saying "to create" would claim
   * the machine's datapoint is missing, which is a different and alarming thing.
   */
  it('says UPDATE when only configs are created on an existing instance', () => {
    const instances = modelInstances(
      workspace,
      'Equip_Four',
      plan([
        item({ kind: 'config', op: 'create', name: 'FOUR001.Temp' }),
        item({ kind: 'dp', op: 'create', name: 'FOUR002' }),
        item({ kind: 'config', op: 'create', name: 'FOUR002.Temp' })
      ])
    );
    expect(instances.map((i) => [i.dpName, i.status])).toEqual([
      ['FOUR001', 'update'],
      ['FOUR002', 'create']
    ]);
  });

  it('lets a CONFLICT outrank everything else on the same instance', () => {
    const instances = modelInstances(
      workspace,
      'Equip_Four',
      plan([
        item({ kind: 'config', op: 'update', name: 'FOUR001.Temp', conflict: true }),
        item({ kind: 'dp', op: 'create', name: 'FOUR001' })
      ])
    );
    expect(instances[0].status).toBe('conflict');
  });

  /**
   * The TYPE belongs to the model, not to its instances: attributing it to each
   * would report N pending changes for one edit, which is exactly the noise the
   * per-instance status exists to remove.
   */
  it('does NOT let the model type mark its instances', () => {
    const typeItem = plan([item({ kind: 'type', op: 'update', name: 'Equip_Four' })]);
    expect(modelInstances(workspace, 'Equip_Four', typeItem).every((i) => i.status === 'synced')).toBe(true);
    expect(modelStatus('Equip_Four', typeItem)).toBe('update');
    expect(modelStatus('Equip_Pompe', typeItem)).toBe('synced');
  });
});

describe('tallyInstances', () => {
  it('counts per status — the global "is everything checked in?" line', () => {
    const instances = modelInstances(
      workspace,
      'Equip_Four',
      plan([item({ kind: 'dp', op: 'create', name: 'FOUR001' }), item({ kind: 'config', op: 'update', name: 'FOUR002.Temp', conflict: true })])
    );
    expect(tallyInstances(instances)).toEqual({ total: 2, synced: 0, create: 1, update: 0, delete: 0, conflict: 1, unmanaged: 0 });
    expect(tallyInstances([])).toEqual({ total: 0, synced: 0, create: 0, update: 0, delete: 0, conflict: 0, unmanaged: 0 });
  });
});

describe('instanceTargets', () => {
  it('states what a re-apply must regenerate: the equipment segment and its device', () => {
    expect(instanceTargets(workspace, 'Equip_Four')).toEqual([
      { equipment: 'FOUR001', deviceId: 's7-four1' },
      { equipment: 'FOUR002', deviceId: 's7-four2' }
    ]);
    // An instance with no address yields no device key rather than an empty one.
    expect(instanceTargets(workspace, 'Equip_Pompe')).toEqual([{ equipment: 'POMPE001' }]);
  });
});
