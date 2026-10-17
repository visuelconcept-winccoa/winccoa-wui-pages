#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Verify the S7comm client of the `s7Browse` manager — against a FAKE CPU.
// -----------------------------------------------------------------------------
//   node tools/check-s7-protocol.mjs
//
// The manager cannot be unit-tested by the workspace runner (it is a CommonJS
// JavaScript manager, outside `libs/**`), and it cannot be tested against a real
// S7-300 from a dev machine. So this runs it against a **fake CPU on a loopback
// socket** that answers correctly-shaped frames — which checks the two halves
// that a hand-written protocol client gets wrong:
//
//   1. what the client SENDS. Every request is asserted byte for byte against the
//      telegram Snap7 builds for the same call (`s7_micro_client.cpp`), because a
//      wrong parameter byte is accepted by nothing and diagnosed by no one;
//   2. what the client MAKES of an answer — including the multi-PDU continuation
//      of `ListBlocksOfType`, the TPKT reassembly of a frame split across two TCP
//      segments, and the refusals (a protected block, a CPU error code).
//
// It exits non-zero on the first failure. It proves the FRAMING, not the dialect
// of any particular CPU — that verification is the live one, and is tracked in
// docs/wui-eng-studio/S7-BROWSING.md "Verification status".
// -----------------------------------------------------------------------------

import net from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { S7Client, S7Error } = require_(resolve(HERE, '..', 'backend', 'managers', 's7Browse', 's7-protocol.js'));

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) return;
  failures += 1;
  console.error(`  ✗ ${label}\n      expected ${b}\n      got      ${a}`);
}

function checkHex(label, actual, expectedHex) {
  check(label, Buffer.from(actual).toString('hex'), expectedHex.replaceAll(' ', '').toLowerCase());
}

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

// --- frame builders, mirroring what a real CPU answers ------------------------

/** Wrap a COTP payload in its TPKT header. */
const tpkt = (payload) => {
  const header = Buffer.alloc(4);
  header[0] = 0x03;
  header.writeUInt16BE(payload.length + 4, 2);
  return Buffer.concat([header, payload]);
};

/** Wrap an S7 message in COTP DT + TPKT. */
const dt = (s7) => tpkt(Buffer.concat([Buffer.from([0x02, 0xf0, 0x80]), s7]));

/** A userdata (ROSCTR 7) answer: 10-byte header, 12-byte params, then data. */
function userdataAnswer({ group, subfunction, sequence = 0x00, more = false, error = 0, data }) {
  const header = Buffer.alloc(10);
  header[0] = 0x32;
  header[1] = 0x07;
  header.writeUInt16BE(0x0000, 2);
  header.writeUInt16BE(0x0001, 4);
  header.writeUInt16BE(12, 6);
  header.writeUInt16BE(data.length, 8);
  const parameters = Buffer.alloc(12);
  parameters.set([0x00, 0x01, 0x12, 0x08, 0x12, group, subfunction, sequence], 0);
  parameters[8] = 0x00;
  parameters[9] = more ? 0x01 : 0x00;
  parameters.writeUInt16BE(error, 10);
  return dt(Buffer.concat([header, parameters, data]));
}

/** A data item: return code, transport size, length, then the payload. */
function dataItem(payload, { returnCode = 0xff, transport = 0x09 } = {}) {
  const head = Buffer.alloc(4);
  head[0] = returnCode;
  head[1] = transport;
  head.writeUInt16BE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

/** The Setup Communication acknowledgement (ROSCTR 3, 12-byte header). */
function negotiateAnswer(pduLength) {
  const header = Buffer.alloc(12);
  header[0] = 0x32;
  header[1] = 0x03;
  header.writeUInt16BE(0x0001, 4);
  header.writeUInt16BE(8, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const parameters = Buffer.alloc(8);
  parameters[0] = 0xf0;
  parameters.writeUInt16BE(1, 2);
  parameters.writeUInt16BE(1, 4);
  parameters.writeUInt16BE(pduLength, 6);
  return dt(Buffer.concat([header, parameters]));
}

/** The COTP connection confirm. */
const connectionConfirm = () =>
  tpkt(Buffer.from([0x11, 0xd0, 0x00, 0x01, 0x00, 0x02, 0x00, 0xc0, 0x01, 0x0b, 0xc1, 0x02, 0x01, 0x00, 0xc2, 0x02, 0x01, 0x02]));

/** A block-info answer body: the 78 data bytes, with the fields under test set. */
function blockInfoPayload({ number, mc7Size, loadSize, language = 0x01, subType = 0x0a, days = 15_000, ms = 3_600_000 }) {
  const body = Buffer.alloc(78);
  body[0] = 0x01; // Cst_b
  body[1] = 0x41; // BlkType
  body[9] = 0x01; // BlkFlags
  body[10] = language;
  body[11] = subType;
  body.writeUInt16BE(number, 12);
  body.writeUInt32BE(loadSize, 14);
  body.writeUInt32BE(ms, 22); // code time, ms of day
  body.writeUInt16BE(days, 26); // code time, days since 1984-01-01
  body.writeUInt32BE(ms, 28);
  body.writeUInt16BE(days, 32);
  body.writeUInt16BE(0, 34); // SbbLen
  body.writeUInt16BE(0, 36); // AddLen
  body.writeUInt16BE(20, 38); // LocDataLen
  body.writeUInt16BE(mc7Size, 40);
  body.write('VC      ', 42, 8, 'latin1');
  body.write('Pompage ', 50, 8, 'latin1');
  body.write('Echange ', 58, 8, 'latin1');
  body[66] = 0x21; // version 2.1
  body.writeUInt16BE(0xabcd, 68);
  return body;
}

/** One SZL answer body: header (record length, count) then the records. */
function szlPayload(id, index, records, recordLength) {
  const head = Buffer.alloc(8);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(index, 2);
  head.writeUInt16BE(recordLength, 4);
  head.writeUInt16BE(records.length, 6);
  return Buffer.concat([head, ...records]);
}

/** An SZL 0x001C record: the index, then the padded ASCII value. */
function componentRecord(index, text, length = 34) {
  const record = Buffer.alloc(length, 0x20);
  record.writeUInt16BE(index, 0);
  record.write(text, 2, length - 2, 'latin1');
  return record;
}

// --- the fake CPU -------------------------------------------------------------

/**
 * A loopback server that records every request and answers from a script.
 *
 * `script` is a list of `{expectHex?, answer, splitAt?}`: the request is asserted
 * against `expectHex` when given, and `splitAt` sends the answer in two TCP
 * writes, which is what exercises the TPKT reassembler.
 */
function fakeCpu(script) {
  const seen = [];
  const server = net.createServer((socket) => {
    let step = 0;
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt16BE(2)) {
        const length = buffer.readUInt16BE(2);
        const request = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        seen.push(Buffer.from(request));
        const entry = script[step];
        step += 1;
        if (entry === undefined) return;
        if (entry.expectHex !== undefined) {
          checkHex(entry.label ?? `request ${step}`, request, entry.expectHex);
        }
        if (entry.answer === null) return; // deliberate silence
        if (entry.splitAt !== undefined) {
          socket.write(entry.answer.subarray(0, entry.splitAt));
          setTimeout(() => socket.write(entry.answer.subarray(entry.splitAt)), 5);
        } else {
          socket.write(entry.answer);
        }
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => resolvePort({ server, port: server.address().port, seen }));
  });
}

/** Connect a client to a fake CPU running `script`. */
async function connected(script, options = {}) {
  const cpu = await fakeCpu([{ answer: connectionConfirm() }, { answer: negotiateAnswer(240) }, ...script]);
  const client = new S7Client({ host: '127.0.0.1', port: cpu.port, rack: 0, slot: 2, timeoutMs: 2000, ...options });
  await client.connect();
  return { client, cpu, done: () => new Promise((r) => cpu.server.close(r)) };
}

// --- the checks ---------------------------------------------------------------

async function checkHandshake() {
  console.log('· COTP connection request and Setup Communication');
  const cpu = await fakeCpu([
    {
      label: 'COTP CR telegram',
      // TPKT(4) + COTP(7) + params(11) = 22 bytes. Source/dest references and the
      // TSAPs follow Snap7: local 0x0100, remote (1 << 8) + 0 * 0x20 + 2 = 0x0102.
      expectHex: '0300 0016 11e0 0000 0001 00 c001 0b c102 0100 c202 0102',
      answer: connectionConfirm()
    },
    {
      label: 'Setup Communication telegram',
      // 32 01 | 0000 | seq | 0008 params | 0000 data | F0 00 0001 0001 01E0
      expectHex: '0300 0019 02f0 80 32 01 0000 0001 0008 0000 f000 0001 0001 01e0',
      answer: negotiateAnswer(240)
    }
  ]);
  const client = new S7Client({ host: '127.0.0.1', port: cpu.port, rack: 0, slot: 2, timeoutMs: 2000 });
  const { pduLength } = await client.connect();
  check('negotiated PDU length', pduLength, 240);
  client.close();
  await new Promise((r) => cpu.server.close(r));

  console.log('· the remote TSAP follows rack and slot');
  for (const [rack, slot, tsap] of [
    [0, 2, 0x0102],
    [1, 3, 0x0123],
    [0, 0, 0x0100]
  ]) {
    const probe = new S7Client({ host: '127.0.0.1', rack, slot });
    check(`TSAP for rack ${rack} slot ${slot}`, probe.remoteTsap, tsap);
  }
}

async function checkListBlocks() {
  console.log('· ListBlocks');
  const counts = Buffer.alloc(28);
  for (const [index, [code, count]] of [
    [0x38, 3],
    [0x41, 2],
    [0x42, 5],
    [0x43, 4],
    [0x44, 12],
    [0x45, 1],
    [0x46, 6]
  ].entries()) {
    counts[index * 4] = 0x30;
    counts[index * 4 + 1] = code;
    counts.writeUInt16BE(count, index * 4 + 2);
  }
  const { client, done } = await connected([
    {
      label: 'ListBlocks telegram',
      // params: 00 01 12 04 11 43 01 00 | data: 0A 00 00 00
      expectHex: '0300 001d 02f0 80 32 07 0000 0002 0008 0004 000112 04 11 43 01 00 0a000000',
      answer: userdataAnswer({ group: 0x43, subfunction: 0x01, data: dataItem(counts) }),
      // Split mid-frame: the reassembler must not hand a half telegram to the parser.
      splitAt: 9
    }
  ]);
  check('block counts', await client.listBlocks(), { OB: 3, DB: 2, SDB: 5, FC: 4, SFC: 12, FB: 1, SFB: 6 });
  client.close();
  await done();
}

async function checkListBlocksOfType() {
  console.log('· ListBlocksOfType, including its multi-PDU continuation');
  const page = (numbers) => {
    const body = Buffer.alloc(numbers.length * 4);
    for (const [index, number] of numbers.entries()) {
      body.writeUInt16BE(number, index * 4);
      body[index * 4 + 2] = 0x00;
      body[index * 4 + 3] = 0x01;
    }
    return dataItem(body);
  };
  const { client, done } = await connected([
    {
      label: 'ListBlocksOfType first telegram',
      // params plen 04, data FF 09 0002 30 41 ("0A" = DB)
      expectHex: '0300 001f 02f0 80 32 07 0000 0002 0008 0006 000112 04 11 43 02 00 ff09 0002 3041',
      answer: userdataAnswer({ group: 0x43, subfunction: 0x02, sequence: 0x07, more: true, data: page([10, 11]) })
    },
    {
      label: 'ListBlocksOfType continuation telegram',
      // params plen 08 + the reserved/error words, echoing the CPU's sequence 0x07
      expectHex: '0300 0021 02f0 80 32 07 0000 0003 000c 0004 000112 08 11 43 02 07 0000 0000 0a000000',
      answer: userdataAnswer({ group: 0x43, subfunction: 0x02, sequence: 0x07, more: false, data: page([200]) })
    }
  ]);
  const listed = await client.listBlocksOfType('DB');
  check('every page is collected', listed.blocks.map((block) => block.number), [10, 11, 200]);
  check('and it is not reported truncated', listed.truncated, false);
  client.close();
  await done();

  console.log('· a CPU that never clears the "more" flag is bounded, and says so');
  const { client: spinner, done: doneSpinner } = await connected(
    Array.from({ length: 12 }, () => ({
      answer: userdataAnswer({ group: 0x43, subfunction: 0x02, sequence: 0x01, more: true, data: page([1]) })
    }))
  );
  const spun = await spinner.listBlocksOfType('DB', { maxRequests: 4 });
  check('the walk stops at the cap', spun.blocks.length, 4);
  check('and reports that it was cut short', spun.truncated, true);
  spinner.close();
  await doneSpinner();
}

async function checkBlockInfo() {
  console.log('· BlockInfo');
  const { client, done } = await connected([
    {
      label: 'BlockInfo telegram',
      // data: FF 09 0008 | 30 41 | "00010" | 41  ("A" = the active filesystem)
      expectHex: '0300 0025 02f0 80 32 07 0000 0002 0008 000c 000112 04 11 43 03 00 ff09 0008 3041 3030303130 41',
      answer: userdataAnswer({
        group: 0x43,
        subfunction: 0x03,
        data: dataItem(blockInfoPayload({ number: 10, mc7Size: 24, loadSize: 92 }))
      })
    }
  ]);
  const info = await client.blockInfo('DB', 10);
  check('block number', info.number, 10);
  check('MC7 size — what the cross-check compares against', info.mc7Size, 24);
  check('load size', info.loadSize, 92);
  check('author', info.author, 'VC');
  check('family', info.family, 'Pompage');
  check('version (high nibble . low nibble)', info.version, '2.1');
  // 15 000 days after 1984-01-01, plus an hour.
  check('code timestamp', info.codeDate, '2025-01-25T01:00:00.000Z');
  client.close();
  await done();

  console.log('· a protected block is a refusal, not a value');
  const { client: locked, done: doneLocked } = await connected([
    {
      answer: userdataAnswer({ group: 0x43, subfunction: 0x03, data: dataItem(Buffer.alloc(0), { returnCode: 0xd2 }) })
    }
  ]);
  let refused = null;
  try {
    await locked.blockInfo('DB', 10);
  } catch (error) {
    refused = error;
  }
  ok('a refusal throws an S7Error', refused instanceof S7Error, String(refused));
  locked.close();
  await doneLocked();

  console.log('· a CPU error in the answer PARAMETERS is surfaced');
  const { client: erring, done: doneErring } = await connected([
    { answer: userdataAnswer({ group: 0x43, subfunction: 0x01, error: 0x8104, data: dataItem(Buffer.alloc(28)) }) }
  ]);
  let cpuError = null;
  try {
    await erring.listBlocks();
  } catch (error) {
    cpuError = error;
  }
  ok('the code is named rather than swallowed', String(cpuError?.message).includes('function not available'), String(cpuError?.message));
  erring.close();
  await doneErring();
}

async function checkSzl() {
  console.log('· ReadSzl (component identification)');
  const records = [componentRecord(1, 'Station_Pompage'), componentRecord(2, 'CPU 315-2 PN/DP'), componentRecord(5, 'S C-C2UC12345678')];
  const { client, done } = await connected([
    {
      label: 'ReadSzl telegram',
      // group 0x44, subfunction 0x01, data FF 09 0004 <id> <index>
      expectHex: '0300 0021 02f0 80 32 07 0000 0002 0008 0008 000112 04 11 44 01 00 ff09 0004 001c 0000',
      answer: userdataAnswer({ group: 0x44, subfunction: 0x01, data: dataItem(szlPayload(0x001c, 0x0000, records, 34)) })
    }
  ]);
  const szl = await client.readSzl(0x001c, 0x0000);
  check('record length is read from the CPU, not assumed', szl.recordLength, 34);
  check('record count', szl.recordCount, 3);
  check('the module name is where the index says it is', szl.records[1].subarray(2).toString('latin1').trim(), 'CPU 315-2 PN/DP');
  client.close();
  await done();
}

async function checkRefusals() {
  console.log('· transport refusals');
  const cpu = await fakeCpu([{ answer: tpkt(Buffer.from([0x05, 0x80, 0x00, 0x00, 0x00, 0x01, 0x03])) }]);
  const client = new S7Client({ host: '127.0.0.1', port: cpu.port, rack: 0, slot: 9, timeoutMs: 1500 });
  let refused = null;
  try {
    await client.connect();
  } catch (error) {
    refused = error;
  }
  ok('a COTP disconnect is reported as a rack/slot problem', String(refused?.message).includes('rack'), String(refused?.message));
  client.close();
  await new Promise((r) => cpu.server.close(r));

  console.log('· a PLC that never answers times out instead of hanging');
  const silent = await fakeCpu([{ answer: connectionConfirm() }, { answer: null }]);
  const patient = new S7Client({ host: '127.0.0.1', port: silent.port, timeoutMs: 300 });
  let timeout = null;
  try {
    await patient.connect();
  } catch (error) {
    timeout = error;
  }
  ok('the timeout is an S7Error naming the delay', String(timeout?.message).includes('300 ms'), String(timeout?.message));
  patient.close();
  await new Promise((r) => silent.server.close(r));

  console.log('· an unreachable host is refused quickly, with the endpoint named');
  const unreachable = new S7Client({ host: '127.0.0.1', port: 1, timeoutMs: 1000 });
  let error = null;
  try {
    await unreachable.connect();
  } catch (caught) {
    error = caught;
  }
  ok('and it says which endpoint', String(error?.message).includes('127.0.0.1:1'), String(error?.message));
  unreachable.close();
}

async function main() {
  console.log('S7comm client — checked against a fake CPU on a loopback socket\n');
  await checkHandshake();
  await checkListBlocks();
  await checkListBlocksOfType();
  await checkBlockInfo();
  await checkSzl();
  await checkRefusals();
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`\n${failures} FAILED.`);
    process.exit(1);
  }
  console.log('OK — the framing matches the Snap7 telegrams it was transcribed from.');
}

main().catch((error) => {
  console.error('check-s7-protocol failed:', error);
  process.exit(1);
});
