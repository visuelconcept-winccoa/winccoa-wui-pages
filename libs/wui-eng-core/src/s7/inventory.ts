// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Online S7 **inventory** — the domain model of what a CPU answers, and the
 * cross-check that makes it worth asking.
 *
 * ## What "browsing" an S7-300/400 can and cannot mean
 *
 * The classic S7 protocol answers a **block directory**, not an address space:
 * which OBs/DBs/FBs/FCs exist, how large each one is, when it was compiled, who
 * wrote it, plus the CPU's own identification (order code, firmware, module
 * name) through the system-status lists. It carries **no symbol and no layout** —
 * a DB is a run of bytes and the CPU has no idea one of them is called
 * `Consigne_Vitesse`. That is a property of the protocol, not of any client
 * library, and it is why the studio's S7 catalogs come from the project's exports
 * (`s7/symbols.ts`, `s7/awl.ts`).
 *
 * So the online side is **not** a generator. It is a VERIFIER, and this module is
 * the part of it that can be unit-tested without a PLC: the manager
 * (`backend/managers/s7Browse`) speaks the protocol and returns an
 * {@link S7Inventory}; {@link crossCheckBookAgainstInventory} decides what that
 * inventory says about a book.
 *
 * ## The four questions the cross-check answers
 *
 * An export is a photograph of a project at a moment; the CPU is what is running
 * now. Everything that can silently diverge between them is worth a check, and
 * each one has a different consequence:
 *
 *  - **a data block the catalog addresses is not in the CPU** — every DPE built
 *    from it will fail to bind. This is the one that turns into "the sensor is
 *    broken" tickets three weeks after a check-in;
 *  - **the catalog reads past the end of a block** — the block was shortened
 *    since the source was generated. The addresses below the cut still work,
 *    which is exactly what makes this dangerous: it looks like a partial failure;
 *  - **the CPU holds data blocks the catalog ignores** — not an error (a project
 *    exports what it chooses), but it is the honest answer to "did I export
 *    everything?", and it can only be asked online;
 *  - **a block was recompiled after the export** — same number, same size,
 *    different content. Nothing can be concluded from a date automatically, so it
 *    is reported for a human, never acted on.
 *
 * None of these ever modifies a book. The catalog stays what the project said;
 * the inventory says how far that is still true.
 */

import type { AddressBook } from '../model.js';
import { WARNING_CODES, warn, type EngWarning } from '../warnings.js';
import { parseS7Operand, type S7Width } from './operand.js';

/** Block kinds the S7 block directory distinguishes. */
export type S7InventoryBlockKind = 'OB' | 'DB' | 'SDB' | 'FC' | 'SFC' | 'FB' | 'SFB';

/** One block the CPU reports. */
export interface S7InventoryBlock {
  kind: S7InventoryBlockKind;
  number: number;
  /** Size of the block's MC7 code / DB data, in bytes. */
  mc7Size?: number;
  /** Size in load memory, in bytes. */
  loadSize?: number;
  /** Block language code as the CPU reports it (AWL, SCL, …). */
  language?: number;
  /** `YYYY-MM-DD` of the last code compilation, when the CPU states it. */
  codeDate?: string;
  /** `YYYY-MM-DD` of the last interface change, when the CPU states it. */
  interfaceDate?: string;
  author?: string;
  family?: string;
  version?: string;
  /** Set when the CPU refused to describe this block (protected / not readable). */
  error?: string;
}

/** CPU identification, read from the system-status lists. */
export interface S7CpuIdentity {
  /** SZL 0x001C index 1 — the module's name. */
  moduleName?: string;
  /** SZL 0x0011 — the MLFB / order code. */
  orderCode?: string;
  /** SZL 0x001C index 5 — the module serial number. */
  serialNumber?: string;
  /** SZL 0x001C index 7 — the module type name. */
  moduleTypeName?: string;
  /** SZL 0x001C index 2 — the plant designation. */
  plantId?: string;
  /** Firmware version, when the module identification carries one. */
  version?: string;
}

/** What one online inventory round-trip produced. */
export interface S7Inventory {
  /** The connection the inventory was read on. */
  connection?: string;
  /** `ip:rack/slot` the manager actually dialled — provenance, never a config. */
  endpoint?: string;
  /** ISO timestamp of the read. */
  readAt: string;
  cpu: S7CpuIdentity;
  /** Block count per kind, as the CPU's own "list all" answers it. */
  counts: Partial<Record<S7InventoryBlockKind, number>>;
  blocks: S7InventoryBlock[];
  /** Negotiated PDU length — the practical read size, worth recording. */
  pduLength?: number;
  /** Problems the manager hit that did not prevent an answer. */
  warnings?: EngWarning[];
}

/** Bytes an operand of this width occupies (a bit still occupies its byte). */
const BYTES_OF_WIDTH: Record<S7Width, number> = { bit: 1, byte: 1, word: 2, dword: 4, none: 0 };

/** The data blocks a catalog addresses, with the highest byte each one reaches. */
export function dataBlocksAddressedBy(book: AddressBook): Map<number, { paths: string[]; highestByte: number }> {
  const used = new Map<number, { paths: string[]; highestByte: number }>();
  for (const entry of book.entries) {
    const reference = entry.addresses.s7;
    if (reference === undefined) continue;
    const operand = parseS7Operand(reference);
    if (operand === null || operand.area !== 'db' || operand.dbNumber === undefined || operand.byteOffset === undefined) continue;
    const reach = operand.byteOffset + (BYTES_OF_WIDTH[operand.width] || 1);
    const current = used.get(operand.dbNumber);
    if (current === undefined) {
      used.set(operand.dbNumber, { paths: [entry.path], highestByte: reach });
      continue;
    }
    current.paths.push(entry.path);
    current.highestByte = Math.max(current.highestByte, reach);
  }
  return used;
}

/** One data block's verdict, for a UI that wants a table rather than prose. */
export interface S7BlockVerdict {
  dbNumber: number;
  /** How many catalog signals address this block. */
  signals: number;
  /** Highest byte the catalog reads (exclusive). */
  highestByte: number;
  /** Size the CPU reports, when it holds the block. */
  cpuSize?: number;
  status: 'ok' | 'absent' | 'overrun' | 'unknown';
}

/** What {@link crossCheckBookAgainstInventory} concluded. */
export interface S7CrossCheck {
  verdicts: S7BlockVerdict[];
  /** Data blocks the CPU holds that the catalog addresses nowhere. */
  uncatalogued: number[];
  warnings: EngWarning[];
}

/** How many names to put in a warning before summarising the rest. */
const NAMED_IN_WARNING = 8;

/** `a, b, c` + `, +N` — one place, so every warning of this file reads alike. */
function listOf(values: (string | number)[]): { names: string; more: string } {
  return {
    names: values.slice(0, NAMED_IN_WARNING).join(', '),
    more: values.length > NAMED_IN_WARNING ? `, +${values.length - NAMED_IN_WARNING}` : ''
  };
}

/**
 * Compare a catalog against what the CPU actually holds.
 *
 * Returns warnings, never a modified book: the catalog is a reading of the
 * project and the inventory is a reading of the machine, and silently reconciling
 * the two would destroy the only information worth having — that they disagree.
 *
 * A block the CPU could not describe (protected, or a `BlockInfo` that failed)
 * yields `unknown`, not `absent`: "we could not ask" and "it is not there" call
 * for different actions, and reporting the first as the second would send an
 * engineer looking for a block that is sitting in the PLC.
 */
export function crossCheckBookAgainstInventory(book: AddressBook, inventory: S7Inventory): S7CrossCheck {
  const warnings: EngWarning[] = [];
  const addressed = dataBlocksAddressedBy(book);
  const cpuBlocks = new Map<number, S7InventoryBlock>();
  for (const block of inventory.blocks) {
    if (block.kind === 'DB') cpuBlocks.set(block.number, block);
  }

  const verdicts: S7BlockVerdict[] = [];
  const absent: number[] = [];
  const overrun: string[] = [];
  const unknown: number[] = [];

  for (const [dbNumber, use] of [...addressed.entries()].sort((a, b) => a[0] - b[0])) {
    const block = cpuBlocks.get(dbNumber);
    if (block === undefined) {
      absent.push(dbNumber);
      verdicts.push({ dbNumber, signals: use.paths.length, highestByte: use.highestByte, status: 'absent' });
      continue;
    }
    if (block.error !== undefined || block.mc7Size === undefined) {
      unknown.push(dbNumber);
      verdicts.push({ dbNumber, signals: use.paths.length, highestByte: use.highestByte, status: 'unknown' });
      continue;
    }
    const status = use.highestByte > block.mc7Size ? 'overrun' : 'ok';
    if (status === 'overrun') overrun.push(`DB${dbNumber} (${use.highestByte} > ${block.mc7Size} B)`);
    verdicts.push({ dbNumber, signals: use.paths.length, highestByte: use.highestByte, cpuSize: block.mc7Size, status });
  }

  if (absent.length > 0) {
    const listed = listOf(absent.map((number) => `DB${number}`));
    warnings.push(
      warn(
        WARNING_CODES.s7browse.DB_ABSENT,
        '⚠️ {n} data block(s) this catalog addresses are NOT in the CPU ({names}{more}) — every signal built from them will fail to bind. The source is newer than the PLC, or the export came from another station.',
        { n: absent.length, ...listed }
      )
    );
  }
  if (overrun.length > 0) {
    const listed = listOf(overrun);
    warnings.push(
      warn(
        WARNING_CODES.s7browse.DB_OVERRUN,
        '⚠️ {n} data block(s) are SHORTER in the CPU than this catalog reads ({names}{more}) — the block was reduced since the source was generated. The addresses below the cut still work, which is what makes this hard to notice.',
        { n: overrun.length, ...listed }
      )
    );
  }
  if (unknown.length > 0) {
    const listed = listOf(unknown.map((number) => `DB${number}`));
    warnings.push(
      warn(
        WARNING_CODES.s7browse.DB_UNKNOWN,
        '{n} data block(s) could not be described by the CPU ({names}{more}) — protected or unreadable. Nothing is concluded about them: this is “not asked”, not “not there”.',
        { n: unknown.length, ...listed }
      )
    );
  }

  const uncatalogued = [...cpuBlocks.keys()].filter((number) => !addressed.has(number)).sort((a, b) => a - b);
  if (uncatalogued.length > 0) {
    const listed = listOf(uncatalogued.map((number) => `DB${number}`));
    warnings.push(
      warn(
        WARNING_CODES.s7browse.DB_UNCATALOGUED,
        '{n} data block(s) present in the CPU are addressed nowhere in this catalog ({names}{more}). Not an error — but it is the only way to find out that an export left something behind.',
        { n: uncatalogued.length, ...listed }
      )
    );
  }
  if (addressed.size === 0) {
    warnings.push(
      warn(
        WARNING_CODES.s7browse.NO_DB_ADDRESSED,
        'This catalog addresses no data block, so the inventory can only confirm the CPU identity ({cpu}) and its {n} block(s). Memory-area signals (inputs, outputs, flags) are not verifiable online: the CPU reports blocks, never a symbol.',
        { cpu: inventory.cpu.moduleTypeName ?? inventory.cpu.orderCode ?? inventory.cpu.moduleName ?? 'unknown', n: inventory.blocks.length }
      )
    );
  }
  return { verdicts, uncatalogued, warnings };
}
