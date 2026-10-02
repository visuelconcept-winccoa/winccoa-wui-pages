// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';
/**
 * **S7 Browse** — WinCC OA JavaScript Manager hosting the MSA vRPC service
 * `S7Browse` for the Engineering Studio's classic-S7 (S7-300/400) catalogs.
 *
 * ## What it is for
 *
 * The studio builds an S7 catalog from the STEP 7 project's own exports — the
 * symbol table and the AWL/DB sources — because the classic S7 protocol carries
 * **no symbols and no layout**: a CPU answers block numbers and byte counts, and
 * nothing else. This manager asks the CPU those questions, so the studio can say
 * how far a catalog built from an export is still true of the machine that is
 * running right now:
 *
 *  - a data block the catalog addresses that the CPU does not hold;
 *  - a block the catalog reads PAST THE END of (it was shortened since);
 *  - blocks in the CPU that the export left behind;
 *  - the CPU's own identity, so an operator knows which machine answered.
 *
 * The verdicts are computed by the pure core
 * (`@visuelconcept/wui-eng-core`, `s7/inventory.ts`, unit-tested with no
 * runtime); this manager only speaks the protocol and reports. Same division as
 * every other service of this suite: one source of engineering truth, and no
 * copy of it in a manager to drift.
 *
 * ## Why a manager and not a webserver route
 *
 * The webserver runs inside the WinCC OA node bootstrap and serves the whole
 * dashboard. Speaking a raw industrial protocol from there means holding TCP
 * sockets to OT equipment on the thread that serves every page of the suite: one
 * unreachable PLC and a 5 s timeout become everybody's problem. A manager isolates
 * it — its own process, its own lifecycle, restartable from pmon without touching
 * the webserver — and it is also the honest place for it: talking to a PLC is a
 * WinCC OA manager's job.
 *
 * ## Read-only, by construction
 *
 * The protocol client (`s7-protocol.js`) implements the block-directory subset
 * and nothing else — no variable read, **no write**, no upload, no run/stop. This
 * service therefore cannot disturb a production PLC, however it is called. The
 * HTTP side is role-gated on top of that (`manage-devices`), but the guarantee
 * that matters is this one, because it does not depend on configuration.
 *
 * ## Register in config/progs
 *
 *   node | manual | 30 | 3 | 5 |s7Browse/index.js
 *
 * `manual` on purpose: this manager only answers requests from the studio, so an
 * operator decides when a project may reach out to its PLCs. `deploy-backend.mjs`
 * writes the line; starting it stays a live-system action.
 *
 * ## Service surface (JSON string in, JSON string out)
 *
 * | Method | Request | Answer |
 * |---|---|---|
 * | `Health` | — | `{ok, service, connections}` |
 * | `Probe` | `{host, rack?, slot?, port?, timeoutMs?}` | `{ok, pduLength, cpu}` |
 * | `Inventory` | `{host, rack?, slot?, port?, timeoutMs?, blockKinds?, maxBlocks?, withBlockInfo?}` | `{ok, inventory}` |
 * | `BlockInfo` | `{host, …, kind, number}` | `{ok, block}` |
 * | `ReadSzl` | `{host, …, id, index?}` | `{ok, recordLength, records[] (hex)}` |
 *
 * `{ok:false, error}` is a refusal the studio shows to the operator; only a
 * programming fault throws. Same convention as `aiAssistant` and the EngStudio
 * CTRL service, so the webserver stub is the same shape.
 */

const { Vrpc } = require('winccoa-manager');
const { S7Client, S7Error, BLOCK_TYPE } = require('./s7-protocol.js');

const SERVICE_NAME = 'S7Browse';

/** Default block kinds an inventory enumerates. */
const DEFAULT_KINDS = ['DB'];

/**
 * Ceiling on the blocks one inventory describes.
 *
 * `BlockInfo` is one round-trip per block, and a large S7-400 can hold hundreds.
 * A bounded walk that SAYS it was bounded beats an unbounded one that appears to
 * hang — the same rule the OPC UA walker follows. Overridable per request.
 */
const DEFAULT_MAX_BLOCKS = 256;

/** Per-request connection timeout, in ms. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * SZL 0x001C (component identification) indices this service names.
 * Anything else in the list is ignored rather than guessed at.
 */
const COMPONENT_INDEX = {
  1: 'systemName',
  2: 'moduleName',
  3: 'plantId',
  5: 'serialNumber',
  7: 'moduleTypeName'
};

/** How many inventories have been served — reported by `Health`. */
let served = 0;

/** Everything a request needs to dial a CPU, validated once. */
function connectionOf(request) {
  const host = String(request.host || request.address || '').trim();
  if (host === '') throw new S7Error('host is required (the PLC IP address)');
  const rack = Number(request.rack === undefined ? 0 : request.rack);
  const slot = Number(request.slot === undefined ? 2 : request.slot);
  if (!Number.isInteger(rack) || rack < 0 || rack > 7) throw new S7Error(`invalid rack ${request.rack}`);
  if (!Number.isInteger(slot) || slot < 0 || slot > 31) throw new S7Error(`invalid slot ${request.slot}`);
  return {
    host,
    rack,
    slot,
    port: Number(request.port || 102),
    timeoutMs: Math.min(Math.max(Number(request.timeoutMs || DEFAULT_TIMEOUT_MS), 500), 30_000),
    ...(request.connectionType === undefined ? {} : { connectionType: Number(request.connectionType) })
  };
}

/** Open a connection, run `work`, and always close — even on a refusal. */
async function withClient(request, work) {
  const options = connectionOf(request);
  const client = new S7Client(options);
  try {
    const { pduLength } = await client.connect();
    return await work(client, { ...options, pduLength });
  } finally {
    client.close();
  }
}

/**
 * CPU identity from the two system-status lists.
 *
 * Never fatal: a CPU that refuses an SZL is still worth inventorying, and an
 * inventory that failed because the *identification* was unavailable would be a
 * worse answer than one that simply does not name the machine. Each failure is
 * reported as a warning instead.
 */
async function readIdentity(client, warnings) {
  const cpu = {};
  try {
    const { records } = await client.readSzl(0x001c, 0x0000);
    for (const record of records) {
      if (record.length < 3) continue;
      const field = COMPONENT_INDEX[record.readUInt16BE(0)];
      if (field === undefined) continue;
      const value = record.subarray(2).toString('latin1').replaceAll('\u0000', ' ').trim();
      if (value !== '') cpu[field] = value;
    }
  } catch (error) {
    warnings.push(`component identification (SZL 0x001C) unavailable: ${error.message}`);
  }
  try {
    // SZL 0x0011 index 1: the module identification. `MlfB` (20 ASCII chars
    // after the index) is the order code — the one field of this record whose
    // encoding is unambiguous, so it is the only one reported. The version words
    // that follow it are carried raw rather than decoded into a firmware string
    // this project has no vendor table for.
    const { records } = await client.readSzl(0x0011, 0x0001);
    const record = records[0];
    if (record !== undefined && record.length >= 22) {
      const orderCode = record.subarray(2, 22).toString('latin1').replaceAll('\u0000', ' ').trim();
      if (orderCode !== '') cpu.orderCode = orderCode;
      if (record.length >= 28) {
        cpu.moduleWords = [record.readUInt16BE(22), record.readUInt16BE(24), record.readUInt16BE(26)]
          .map((word) => `0x${word.toString(16).padStart(4, '0')}`)
          .join(' ');
      }
    }
  } catch (error) {
    warnings.push(`module identification (SZL 0x0011) unavailable: ${error.message}`);
  }
  return cpu;
}

/** `Health` — is the manager up, and has it ever been used. */
async function health() {
  return { ok: true, service: SERVICE_NAME, served, readOnly: true };
}

/** `Probe` — connect, negotiate, identify, disconnect. The cheapest question. */
async function probe(request) {
  return withClient(request, async (client, options) => {
    const warnings = [];
    const cpu = await readIdentity(client, warnings);
    return {
      ok: true,
      endpoint: `${options.host}:${options.rack}/${options.slot}`,
      pduLength: options.pduLength,
      cpu,
      ...(warnings.length === 0 ? {} : { warnings })
    };
  });
}

/**
 * `Inventory` — the whole block directory, with one `BlockInfo` per block.
 *
 * `withBlockInfo: false` stops after the numbers, which is the right call on a
 * CPU holding hundreds of blocks when only the presence matters.
 */
async function inventory(request) {
  const kinds = Array.isArray(request.blockKinds) && request.blockKinds.length > 0 ? request.blockKinds : DEFAULT_KINDS;
  const maxBlocks = Math.min(Math.max(Number(request.maxBlocks || DEFAULT_MAX_BLOCKS), 1), 4096);
  const withBlockInfo = request.withBlockInfo !== false;

  return withClient(request, async (client, options) => {
    const warnings = [];
    const cpu = await readIdentity(client, warnings);

    let counts = {};
    try {
      counts = await client.listBlocks();
    } catch (error) {
      warnings.push(`block count unavailable: ${error.message}`);
    }

    const blocks = [];
    let described = 0;
    for (const kind of kinds) {
      if (BLOCK_TYPE[kind] === undefined) {
        warnings.push(`unknown block type '${kind}' — ignored`);
        continue;
      }
      let listed;
      try {
        listed = await client.listBlocksOfType(kind);
      } catch (error) {
        warnings.push(`${kind} listing failed: ${error.message}`);
        continue;
      }
      if (listed.truncated) warnings.push(`the ${kind} listing was cut short by the request cap — the list is incomplete`);
      for (const item of listed.blocks) {
        if (described >= maxBlocks) {
          warnings.push(`stopped after ${maxBlocks} blocks (raise maxBlocks to describe more) — the list is incomplete`);
          described = Number.POSITIVE_INFINITY;
          break;
        }
        if (!withBlockInfo) {
          blocks.push({ kind, number: item.number, language: item.language });
          described += 1;
          continue;
        }
        try {
          const info = await client.blockInfo(kind, item.number);
          blocks.push({ kind, number: item.number, ...info });
        } catch (error) {
          // A protected block is normal on a real project: report it AS the block
          // it is, so the cross-check can say "not asked" rather than "not there".
          blocks.push({ kind, number: item.number, error: error.message });
        }
        described += 1;
      }
      if (described === Number.POSITIVE_INFINITY) break;
    }

    served += 1;
    return {
      ok: true,
      inventory: {
        endpoint: `${options.host}:${options.rack}/${options.slot}`,
        readAt: new Date().toISOString(),
        pduLength: options.pduLength,
        cpu,
        counts,
        blocks,
        ...(warnings.length === 0 ? {} : { warnings })
      }
    };
  });
}

/** `BlockInfo` — describe exactly one block. */
async function blockInfo(request) {
  const kind = String(request.kind || 'DB').toUpperCase();
  const number = Number(request.number);
  return withClient(request, async (client) => ({ ok: true, block: { kind, number, ...(await client.blockInfo(kind, number)) } }));
}

/**
 * `ReadSzl` — one system-status list, records handed back as hex.
 *
 * Hex rather than a decoded structure because the SZL catalogue is large and
 * mostly undocumented outside Siemens' own manuals: decoding a list this project
 * has no table for would be inventing meaning. The caller gets exactly what the
 * CPU said, with the record length the CPU itself declared.
 */
async function readSzl(request) {
  const id = Number(request.id);
  if (!Number.isInteger(id) || id < 0 || id > 0xffff) throw new S7Error(`invalid SZL id ${request.id}`);
  const index = Number(request.index || 0);
  return withClient(request, async (client) => {
    const result = await client.readSzl(id, index);
    return {
      ok: true,
      id,
      index,
      recordLength: result.recordLength,
      recordCount: result.recordCount,
      records: result.records.map((record) => record.toString('hex'))
    };
  });
}

const METHODS = { Health: health, Probe: probe, Inventory: inventory, BlockInfo: blockInfo, ReadSzl: readSzl };

/** Answer envelope — the same `Variant<string JSON>` convention as every service here. */
function reply(object) {
  return Vrpc.Variant.createString(JSON.stringify(object));
}

/**
 * The vRPC service, one registered function per entry of {@link METHODS}.
 *
 * A protocol or validation refusal comes back as `{ok:false, error}` — it is an
 * ENGINEERING answer the operator must read ("rack/slot wrong", "block
 * protected", "no route to host"), not a transport failure. Only an unexpected
 * fault is logged as one, so the manager's log stays a list of real defects
 * rather than a list of PLCs that were switched off.
 */
class S7BrowseService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    for (const [name, handler] of Object.entries(METHODS)) {
      this.registerFunction(name, (context, payload) => this.run(name, handler, context, payload));
    }
  }

  async run(name, handler, context, payload) {
    context.cancelSignal?.throwIfAborted?.();
    let request = {};
    try {
      request = JSON.parse(String(payload?.value ?? '{}') || '{}');
    } catch (error) {
      return reply({ ok: false, error: `malformed request: ${error.message}` });
    }
    try {
      return reply(await handler(request));
    } catch (error) {
      if (!(error instanceof S7Error)) console.error(`${SERVICE_NAME}.${name}:`, error);
      return reply({ ok: false, error: error?.message ?? String(error) });
    }
  }
}

async function main() {
  const container = new Vrpc.ServiceContainer();
  container.registerService(new S7BrowseService(), new Vrpc.ServiceOptions());
  await container.startAllServices();
  console.info(`${SERVICE_NAME}: ready — READ-ONLY S7 block directory (${Object.keys(METHODS).join(', ')}).`);
}

main().catch((error) => {
  console.error(`${SERVICE_NAME}: failed to start:`, error);
  process.exitCode = 1;
});
