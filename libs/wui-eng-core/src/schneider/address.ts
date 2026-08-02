// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Schneider (Modicon M340 / M580 / Premium, EcoStruxure Control Expert) —
 * located-variable addresses → Modbus data-model references.
 *
 * VERIFIED mapping (Schneider community + integrator documentation):
 *  - a located variable at `%MWn` is read as **holding register n**, i.e. the
 *    standard notation `40001 + n` (`%MW0` → `40001`, `%MW4513` → `44514`);
 *  - `%M` (coils, 0x) and `%I` (discrete inputs, 1x) SHARE the same memory on
 *    M340/M580: with memory management "Topological", FC1 *and* FC2 read `%M`;
 *    with "mixed topological and state RAM", FC1 reads `%M` and FC2 reads `%I`.
 *    The bit mapping is therefore configuration-dependent → flagged, not guessed;
 *  - only **located** variables exist for a Modbus client: a variable without an
 *    address in the Control Expert data editor is NOT reachable.
 *
 * `%MD`/`%MF` (double word / float) overlay `%MW`: `%MD100` occupies `%MW100`
 * and `%MW101`, so they resolve to the same holding register with a 2-register
 * span. Topological addresses (`%I0.1.2`, `%Q…`) are NOT Modbus-addressable —
 * they must be copied to a located `%MW` in the PLC program.
 */

import { modbusCoilRef, modbusDiscreteInputRef, modbusHoldingRef, modbusInputRegisterRef } from '../drivers/modbus.js';

/** Modbus data-model object a located variable resolves to. */
export type ModbusObject = 'holding' | 'coil' | 'discrete-input' | 'input-register';

/** A parsed Schneider located variable. */
export interface SchneiderAddress {
  /** Original text, e.g. `%MW100`. */
  raw: string;
  /** Prefix without `%`, upper-case: `MW`, `M`, `MD`, `MF`, `I`, `IW`, … */
  kind: string;
  /** Numeric index (the `%MW` number). */
  index: number;
  /** Modbus object it maps to, or null when not Modbus-addressable. */
  object: ModbusObject | null;
  /** Standard Modbus reference (`44514`, `00001`, …), or null. */
  reference: string | null;
  /** Registers/bits spanned (2 for MD/MF). */
  span: number;
  /** Why the address is not Modbus-addressable, when applicable. */
  note?: string;
}

/** Topological address (`%I0.1.2`, `%QW1.2`) — not reachable over Modbus. */
const TOPOLOGICAL = /^%[A-Z]+\d+\.\d/i;

/**
 * Parse a Schneider located-variable address. Returns null when the text is not
 * an address at all (empty / unlocated variable).
 */
export function parseSchneiderAddress(raw: string): SchneiderAddress | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  if (TOPOLOGICAL.test(text)) {
    return {
      raw: text,
      kind: (/^%([A-Z]+)/i.exec(text)?.[1] ?? '').toUpperCase(),
      index: -1,
      object: null,
      reference: null,
      span: 1,
      note: 'topological address (rack.module.channel) — not addressable over Modbus; copy it to a located %MW in the program'
    };
  }
  const match = /^%([A-Z]+)(\d+)$/i.exec(text);
  if (!match) {
    return null;
  }
  const kind = match[1].toUpperCase();
  const index = Number.parseInt(match[2], 10);
  switch (kind) {
    case 'MW': {
      return { raw: text, kind, index, object: 'holding', reference: modbusHoldingRef(index), span: 1 };
    }
    case 'MD':
    case 'MF': {
      // Overlay two consecutive %MW words.
      return { raw: text, kind, index, object: 'holding', reference: modbusHoldingRef(index), span: 2 };
    }
    case 'M': {
      return {
        raw: text,
        kind,
        index,
        object: 'coil',
        reference: modbusCoilRef(index),
        span: 1,
        note: '%M and %I share the memory: an FC1/FC2 read depends on the memory setting (Topological vs mixed topological/state RAM)'
      };
    }
    case 'I': {
      return {
        raw: text,
        kind,
        index,
        object: 'discrete-input',
        reference: modbusDiscreteInputRef(index),
        span: 1,
        note: '%M and %I share the memory: an FC1/FC2 read depends on the memory setting (Topological vs mixed topological/state RAM)'
      };
    }
    case 'IW': {
      return { raw: text, kind, index, object: 'input-register', reference: modbusInputRegisterRef(index), span: 1 };
    }
    default: {
      // %KW (constants), %S/%SW (system), %QW… — not part of the verified mapping.
      return {
        raw: text,
        kind,
        index,
        object: null,
        reference: null,
        span: 1,
        note: `the %${kind} prefix is outside the verified Modbus mapping — confirm it on the PLC`
      };
    }
  }
}

/**
 * Registers occupied by a variable: the address span, widened by the datatype
 * when it is larger than one word (a DINT at `%MW100` occupies 100 and 101).
 */
export function occupiedRegisters(address: SchneiderAddress, typeSpan: number): number[] {
  if (address.object !== 'holding' && address.object !== 'input-register') {
    return [];
  }
  const span = Math.max(address.span, typeSpan);
  return Array.from({ length: span }, (_v, i) => address.index + i);
}
