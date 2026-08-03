// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan applier contract, proven against an in-memory fake port (no WinCC OA):
 * idempotent creates, conflict refusal, atomic config writes through the
 * builders, dry-run reporting.
 */
import { describe, expect, it } from 'vitest';
import { applyPlan, type EngPort } from './apply.js';
import type { AddressConfig, DpTypeStructure, EngPlan } from './model.js';

interface FakeState {
  types: Map<string, DpTypeStructure>;
  dps: Map<string, string>;
  writes: { dpes: string[]; values: unknown[] }[];
}

function fakePort(state: FakeState): EngPort {
  return {
    typeExists: async (name) => state.types.has(name),
    dpTypeCreate: async (structure) => void state.types.set(structure.name, structure),
    dpTypeChange: async (structure) => void state.types.set(structure.name, structure),
    dpTypeDelete: async (name) => void state.types.delete(name),
    dpExists: async (name) => state.dps.has(name),
    dpCreate: async (name, type) => void state.dps.set(name, type),
    dpDelete: async (name) => void state.dps.delete(name),
    dpSetWait: async (dpes, values) => void state.writes.push({ dpes, values }),
    resolveAddressContext: async () => ({ driverNumber: 2, pollGroupDp: '_EngStudio_Poll' })
  };
}

function state(): FakeState {
  return { types: new Map(), dps: new Map(), writes: [] };
}

const ADDRESS: AddressConfig = {
  deviceId: 'opc1',
  mode: 'opcua',
  reference: 'Cellule1$$1$1$ns=2;s=Pump1.Flow',
  direction: 4,
  datatype: 761,
  active: true
};

describe('applyPlan', () => {
  it('applies types, dps and configs in plan order', async () => {
    const s = state();
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [
        {
          kind: 'type',
          op: 'create',
          name: 'Equip_Pompe',
          payload: { typeName: 'Equip_Pompe', structure: { name: 'Equip_Pompe', type: 'Struct', children: [{ name: 'Debit', type: 'Float' }] } }
        },
        { kind: 'dp', op: 'create', name: 'Z01_PMP001', payload: { dpName: 'Z01_PMP001', dpType: 'Equip_Pompe' } },
        { kind: 'config', op: 'create', name: 'Z01_PMP001.Debit', payload: { address: ADDRESS } }
      ]
    };
    const report = await applyPlan(plan, fakePort(s));
    expect(report.ok).toBe(true);
    expect(report.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
    expect(s.types.has('Equip_Pompe')).toBe(true);
    expect(s.dps.get('Z01_PMP001')).toBe('Equip_Pompe');
    // One ATOMIC write carrying _distrib + _address with the resolved context.
    expect(s.writes).toHaveLength(1);
    const write = s.writes[0];
    expect(write.dpes[0]).toBe('Z01_PMP001.Debit:_distrib.._type');
    expect(write.values[1]).toBe(2); // driver number from the port
    expect(write.dpes).toContain('Z01_PMP001.Debit:_address.._reference');
    expect(write.values[write.dpes.indexOf('Z01_PMP001.Debit:_address.._poll_group')]).toBe('_EngStudio_Poll');
  });

  it('is idempotent: creating an existing object reports skipped', async () => {
    const s = state();
    s.dps.set('Z01_PMP001', 'Equip_Pompe');
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [{ kind: 'dp', op: 'create', name: 'Z01_PMP001', payload: { dpName: 'Z01_PMP001', dpType: 'Equip_Pompe' } }]
    };
    const report = await applyPlan(plan, fakePort(s));
    expect(report.results[0].status).toBe('skipped');
    expect(report.ok).toBe(true);
  });

  it('refuses conflicting items', async () => {
    const s = state();
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [{ kind: 'type', op: 'delete', name: 'Equip_Pompe', conflict: true }]
    };
    const report = await applyPlan(plan, fakePort(s));
    expect(report.results[0].status).toBe('skipped');
    expect(report.results[0].error).toContain('conflict');
  });

  it('emits the 3-step analog alarm sequence, each step atomic', async () => {
    const s = state();
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [
        {
          kind: 'config',
          op: 'update',
          name: 'Z01_FOUR001.Temperature',
          payload: {
            alarm: { kind: 'analog', alarmClass: 'alert', direction: 'ASC', thresholds: [400], bounds: [-1000, 1000], active: true }
          }
        }
      ]
    };
    const report = await applyPlan(plan, fakePort(s));
    expect(report.ok).toBe(true);
    expect(s.writes).toHaveLength(3);
    expect(s.writes[0].dpes[0]).toBe('Z01_FOUR001.Temperature:_alert_hdl.._type');
    expect(s.writes[2]).toEqual({ dpes: ['Z01_FOUR001.Temperature:_alert_hdl.._active'], values: [true] });
  });

  it('dry-run executes nothing but reports outcomes', async () => {
    const s = state();
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [
        { kind: 'dp', op: 'create', name: 'Z01_PMP001', payload: { dpName: 'Z01_PMP001', dpType: 'Equip_Pompe' } },
        { kind: 'type', op: 'delete', name: 'X', conflict: true }
      ]
    };
    const report = await applyPlan(plan, fakePort(s), { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.results.map((r) => r.status)).toEqual(['applied', 'skipped']);
    expect(s.dps.size).toBe(0);
    expect(s.writes).toHaveLength(0);
  });

  it('retires configs on delete using the live previous configs', async () => {
    const s = state();
    const plan: EngPlan = {
      workspace: 'ws1',
      warnings: [],
      items: [{ kind: 'config', op: 'delete', name: 'Z01_PMP001.Debit' }]
    };
    const report = await applyPlan(plan, fakePort(s), {
      previousConfigs: { 'Z01_PMP001.Debit': { address: ADDRESS, archive: { group: 'EVENT', active: true } } }
    });
    expect(report.ok).toBe(true);
    expect(s.writes).toEqual([
      { dpes: ['Z01_PMP001.Debit:_address.._active'], values: [false] },
      { dpes: ['Z01_PMP001.Debit:_archive.._archive'], values: [false] }
    ]);
  });
});
