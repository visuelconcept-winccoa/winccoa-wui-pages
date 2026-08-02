// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schneider located-variable → Modbus reference mapping. The `%MW` anchors are
 * the verified ones (`%MW0` → 40001, `%MW4513` → 44514).
 */
import { describe, expect, it } from 'vitest';
import { occupiedRegisters, parseSchneiderAddress } from './address.js';

describe('parseSchneiderAddress', () => {
  it('maps %MW to holding registers (40001 + n)', () => {
    expect(parseSchneiderAddress('%MW0')).toMatchObject({ object: 'holding', reference: '40001', span: 1 });
    expect(parseSchneiderAddress('%MW100')).toMatchObject({ object: 'holding', reference: '40101' });
    expect(parseSchneiderAddress('%MW4513')).toMatchObject({ object: 'holding', reference: '44514' });
  });

  it('treats %MD/%MF as two-word overlays of the same holding register', () => {
    expect(parseSchneiderAddress('%MD108')).toMatchObject({ object: 'holding', reference: '40109', span: 2 });
    expect(parseSchneiderAddress('%MF104')).toMatchObject({ object: 'holding', reference: '40105', span: 2 });
  });

  it('maps %M to coils and %I to discrete inputs, flagging the shared memory', () => {
    const coil = parseSchneiderAddress('%M0');
    expect(coil).toMatchObject({ object: 'coil', reference: '00001' });
    expect(coil?.note).toMatch(/partagent la mémoire/);
    expect(parseSchneiderAddress('%M10')).toMatchObject({ reference: '00011' });
    expect(parseSchneiderAddress('%I5')).toMatchObject({ object: 'discrete-input', reference: '10006' });
  });

  it('maps %IW to input registers', () => {
    expect(parseSchneiderAddress('%IW200')).toMatchObject({ object: 'input-register', reference: '30201' });
  });

  it('refuses topological addresses (not Modbus-addressable)', () => {
    const topological = parseSchneiderAddress('%I0.2.3');
    expect(topological?.object).toBeNull();
    expect(topological?.reference).toBeNull();
    expect(topological?.note).toMatch(/topologique/);
  });

  it('flags prefixes outside the verified mapping instead of guessing', () => {
    const system = parseSchneiderAddress('%SW60');
    expect(system?.object).toBeNull();
    expect(system?.note).toMatch(/hors correspondance Modbus vérifiée/);
  });

  it('returns null for an unlocated variable', () => {
    expect(parseSchneiderAddress('')).toBeNull();
    expect(parseSchneiderAddress('   ')).toBeNull();
  });
});

describe('occupiedRegisters', () => {
  it('widens the span with the datatype (DINT at %MW112 → 112, 113)', () => {
    const address = parseSchneiderAddress('%MW112');
    expect(occupiedRegisters(address!, 2)).toEqual([112, 113]);
  });

  it('is empty for bit objects (no register footprint)', () => {
    const coil = parseSchneiderAddress('%M10');
    expect(occupiedRegisters(coil!, 1)).toEqual([]);
  });
});
