// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Proves the confirmed nested-type contract: nested types are NESTED into the
 * top-level datapoint type (as a `Typeref` when shared, else a flattened
 * `Struct`), and datapoints (instances) are created ONLY for the top-level type
 * — never for the nested types. Also covers the transitive-typeref creation
 * order (a referrer must never precede a type it references).
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from './generate.js';
import type { LeafMember, Member, RefMember, TagModel, TypeDef } from './model.js';

function leaf(name: string): LeafMember {
  return { kind: 'leaf', name, dataType: 'Float', access: 'r', arrayRank: 0, sourceDataType: 'Double' };
}
function ref(name: string, typeId: string): RefMember {
  return { kind: 'ref', name, typeId };
}
function type(id: string, members: Member[]): TypeDef {
  return { id, name: id, displayName: id, members };
}
function model(types: TypeDef[], instanceOf: Record<string, string>): TagModel {
  return {
    source: 'opcua-nodeset',
    namespaces: [],
    warnings: [],
    types,
    instances: Object.entries(instanceOf).map(([name, typeId]) => ({ name, displayName: name, typeId, bindings: {} }))
  };
}

describe('DpTypeGenerator — nested types embedded, only top-level instances', () => {
  it('flattens a single-parent nested type into the parent and creates only top-level DPs', () => {
    const m = model(
      [type('PumpType', [leaf('Flow'), ref('Motor', 'MotorType')]), type('MotorType', [leaf('Speed')])],
      { Pump1: 'PumpType', Pump2: 'PumpType' }
    );
    const plan = buildPlan(m, { typePrefix: '', hybrid: true });

    // Only the top-level type is created; MotorType is embedded, not its own DPType.
    expect(plan.types.map((t) => t.typeName)).toEqual(['PumpType']);
    const motor = plan.types[0].structure.children?.find((c) => c.name === 'Motor');
    expect(motor?.type).toBe('Struct');
    expect(motor?.children?.map((c) => c.name)).toEqual(['Speed']);

    // Datapoints only for the two top-level instances — no Motor DP.
    expect(plan.dps.map((d) => d.dpName)).toEqual(['Pump1', 'Pump2']);
    expect(plan.dps.every((d) => d.dpType === 'PumpType')).toBe(true);
  });

  it('keeps a shared nested type as a typeref, created before its referrers, still only top-level DPs', () => {
    const m = model(
      [
        type('PumpType', [leaf('Flow'), ref('Motor', 'MotorType')]),
        type('FanType', [leaf('Rpm'), ref('Motor', 'MotorType')]),
        type('MotorType', [leaf('Speed')])
      ],
      { Pump1: 'PumpType', Fan1: 'FanType' }
    );
    const plan = buildPlan(m, { typePrefix: '', hybrid: true });
    const order = plan.types.map((t) => t.typeName);

    expect(order.sort()).toEqual(['FanType', 'MotorType', 'PumpType']);
    const created = plan.types.map((t) => t.typeName);
    expect(created.indexOf('MotorType')).toBeLessThan(created.indexOf('PumpType'));
    expect(created.indexOf('MotorType')).toBeLessThan(created.indexOf('FanType'));

    const pump = plan.types.find((t) => t.typeName === 'PumpType');
    const motor = pump?.structure.children?.find((c) => c.name === 'Motor');
    expect(motor?.type).toBe('Typeref');
    expect(motor?.refName).toBe('MotorType');

    // Only Pump1 + Fan1 — no Motor datapoint.
    expect(plan.dps.map((d) => d.dpName).sort()).toEqual(['Fan1', 'Pump1']);
  });

  it('orders a transitively-referenced (kept) type before a referrer that reaches it through a flattened type', () => {
    // P -> Q (flattened, single parent) -> R (shared by Q and S -> kept);  S -> R.
    const m = model(
      [
        type('P', [ref('q', 'Q')]),
        type('Q', [ref('r', 'R')]),
        type('S', [ref('r', 'R')]),
        type('R', [leaf('V')])
      ],
      { p1: 'P', s1: 'S' }
    );
    const plan = buildPlan(m, { typePrefix: '', hybrid: true });
    const order = plan.types.map((t) => t.typeName);

    // Q is flattened away; R is kept (shared) and P inlines Q which typerefs R.
    expect(order).not.toContain('Q');
    expect(order).toContain('R');
    expect(order.indexOf('R')).toBeLessThan(order.indexOf('P'));

    // Datapoints only for the two top-level instances.
    expect(plan.dps.map((d) => d.dpName).sort()).toEqual(['p1', 's1']);
  });
});

describe('DpTypeGenerator — reuse mapping', () => {
  it('never lets a created type collide with a reuse-target name', () => {
    // A is created (proposes name "A"); B reuses an existing type also named "A".
    const m = model([type('A', [leaf('x')]), type('B', [leaf('y')])], { a1: 'A', b1: 'B' });
    const plan = buildPlan(m, { typePrefix: '', hybrid: true, typeMapping: { B: { target: 'A', extend: false } } });

    const reused = plan.types.filter((t) => t.reuse);
    const created = plan.types.filter((t) => !t.reuse);
    expect(reused.map((t) => t.typeName)).toContain('A');
    // The created type must NOT reuse the reserved target name.
    expect(created.every((t) => t.typeName !== 'A')).toBe(true);
    // Each datapoint keeps its own type: b1 on the reused "A", a1 on the distinct created one.
    expect(plan.dps.find((d) => d.dpName === 'b1')?.dpType).toBe('A');
    expect(plan.dps.find((d) => d.dpName === 'a1')?.dpType).not.toBe('A');
  });
});
