// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operand contract: the two mnemonic languages read to ONE area, the padding an
 * export writes is layout rather than meaning, block names are recognised as
 * such, and a notation that addresses nothing is refused instead of guessed.
 */
import { describe, expect, it } from 'vitest';
import { isS7Signal, parseS7Operand, s7DeclaredWidth, s7WidthAgrees } from './operand.js';

describe('parseS7Operand', () => {
  it('reads the German and the English mnemonics into the same area', () => {
    expect(parseS7Operand('E0.0')).toMatchObject({ area: 'input', width: 'bit', byteOffset: 0, bitOffset: 0 });
    expect(parseS7Operand('I0.0')).toMatchObject({ area: 'input', width: 'bit' });
    expect(parseS7Operand('A4.7')).toMatchObject({ area: 'output', width: 'bit', byteOffset: 4, bitOffset: 7 });
    expect(parseS7Operand('Q4.7')).toMatchObject({ area: 'output', width: 'bit' });
    expect(parseS7Operand('Z3')).toMatchObject({ area: 'counter' });
    expect(parseS7Operand('C3')).toMatchObject({ area: 'counter' });
  });

  it('reads the sized flag/input/output operands', () => {
    expect(parseS7Operand('MB10')).toMatchObject({ area: 'flag', width: 'byte', byteOffset: 10 });
    expect(parseS7Operand('MW20')).toMatchObject({ area: 'flag', width: 'word', byteOffset: 20 });
    expect(parseS7Operand('MD30')).toMatchObject({ area: 'flag', width: 'dword', byteOffset: 30 });
    expect(parseS7Operand('EB0')).toMatchObject({ area: 'input', width: 'byte' });
    expect(parseS7Operand('AD8')).toMatchObject({ area: 'output', width: 'dword' });
  });

  it('reads the peripheral areas, which the plain letters would otherwise swallow', () => {
    expect(parseS7Operand('PEW256')).toMatchObject({ area: 'peripheral-input', width: 'word', byteOffset: 256 });
    expect(parseS7Operand('PIW256')).toMatchObject({ area: 'peripheral-input', width: 'word' });
    expect(parseS7Operand('PAB4')).toMatchObject({ area: 'peripheral-output', width: 'byte' });
    expect(parseS7Operand('PQW4')).toMatchObject({ area: 'peripheral-output', width: 'word' });
  });

  it('reads a DB member, bit offset included', () => {
    expect(parseS7Operand('DB10.DBX4.2')).toMatchObject({ area: 'db', width: 'bit', dbNumber: 10, byteOffset: 4, bitOffset: 2 });
    expect(parseS7Operand('DB10.DBW4')).toMatchObject({ area: 'db', width: 'word', dbNumber: 10, byteOffset: 4 });
    expect(parseS7Operand('DB10.DBD4')).toMatchObject({ area: 'db', width: 'dword' });
    expect(parseS7Operand('DB10.DBB4')).toMatchObject({ area: 'db', width: 'byte' });
  });

  it('treats the padding of a fixed-width export as layout, not meaning', () => {
    expect(parseS7Operand('E      0.3')?.raw).toBe('E0.3');
    expect(parseS7Operand('DB      10')).toMatchObject({ area: 'block', blockKind: 'DB', blockNumber: 10 });
    expect(parseS7Operand('  mw  20  ')?.raw).toBe('MW20');
  });

  it('recognises block names as blocks — they address no value', () => {
    for (const [text, kind] of [
      ['DB10', 'DB'],
      ['FB1', 'FB'],
      ['FC2', 'FC'],
      ['OB35', 'OB'],
      ['SFB4', 'SFB'],
      ['SFC64', 'SFC'],
      ['UDT2', 'UDT']
    ] as const) {
      const operand = parseS7Operand(text);
      expect(operand).toMatchObject({ area: 'block', blockKind: kind, isBlock: true });
      expect(isS7Signal(operand!)).toBe(false);
    }
  });

  it('does not read SFB1 as an FB with a stray S', () => {
    expect(parseS7Operand('SFB1')?.blockKind).toBe('SFB');
    expect(parseS7Operand('SDB1')?.blockKind).toBe('SDB');
  });

  it('REFUSES a notation that addresses nothing rather than guessing a bit 0', () => {
    expect(parseS7Operand('DB10.DBX4')).toBeNull();
    expect(parseS7Operand('DB10.DBW4.2')).toBeNull();
    expect(parseS7Operand('E0.8')).toBeNull();
    expect(parseS7Operand('Marche_Pompe')).toBeNull();
    expect(parseS7Operand('')).toBeNull();
  });
});

describe('s7WidthAgrees', () => {
  it('catches a declared type that contradicts its own address', () => {
    expect(s7WidthAgrees(parseS7Operand('MW20')!, 'Bool')).toBe(false);
    expect(s7WidthAgrees(parseS7Operand('M20.0')!, 'Real')).toBe(false);
  });

  it('accepts an agreement, and stays silent where nothing can be compared', () => {
    expect(s7WidthAgrees(parseS7Operand('MW20')!, 'Int')).toBe(true);
    expect(s7WidthAgrees(parseS7Operand('MD30')!, 'Real')).toBe(true);
    // A timer has no memory width, and neither has an unknown type: no verdict.
    expect(s7WidthAgrees(parseS7Operand('T5')!, 'Timer')).toBe(true);
    expect(s7WidthAgrees(parseS7Operand('MW20')!, 'UDT_Moteur')).toBe(true);
  });
});

describe('s7DeclaredWidth', () => {
  it('maps the elementary types an export declares', () => {
    expect(s7DeclaredWidth('BOOL')).toBe('bit');
    expect(s7DeclaredWidth('Byte')).toBe('byte');
    expect(s7DeclaredWidth('INT')).toBe('word');
    expect(s7DeclaredWidth('Real')).toBe('dword');
    expect(s7DeclaredWidth('TIMER')).toBeUndefined();
  });
});
