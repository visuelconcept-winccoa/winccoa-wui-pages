// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';
/**
 * Minimal **S7comm client** (ISO-on-TCP / RFC 1006) — the block-directory subset.
 *
 * Only what an inventory needs, and deliberately nothing else: connect, negotiate
 * the PDU size, read the system-status lists, count the blocks, list the data
 * blocks and describe them. **No read, no write, no upload, no run/stop.** The
 * studio's online S7 feature is a VERIFIER of catalogs built from STEP 7 exports
 * (see `libs/wui-eng-core/src/s7/`), and a client that cannot write is a client
 * that cannot be turned into a way to disturb a production PLC by a bug or by a
 * mistaken operator. That restriction is the design, not an unfinished state.
 *
 * ## Why this is hand-written and not a library
 *
 * The reference implementation of this protocol is Snap7 (and its Python binding),
 * which is a **native** library: using it would mean a compiled addon inside the
 * WinCC OA node runtime, rebuilt for its exact ABI on every host. The subset an
 * inventory needs is small and entirely request/response, so it is implemented
 * here over `node:net` with no dependency at all — the same rule every other JS
 * manager of this project follows.
 *
 * ## Every byte below has a source
 *
 * The frame layouts are transcribed from the Snap7 sources and cross-checked
 * against the Wireshark S7comm dissector, both public:
 *
 *  - `snap7/src/core/s7_isotcp.{h,cpp}` — TPKT, COTP CR/CC and DT, the TSAP
 *    parameters and the `(ConnectionType << 8) + rack * 0x20 + slot` rule;
 *  - `snap7/src/core/s7_peer.cpp` — `NegotiatePDULength`;
 *  - `snap7/src/core/s7_micro_client.cpp` — `opListBlocks`, `opListBlocksOfType`
 *    (including its multi-PDU continuation), `opAgBlockInfo`, `opReadSZL`;
 *  - `snap7/src/core/s7_types.h` — the request/response structures and the
 *    constants (`grBlocksInfo = 0x43`, `grSZL = 0x44`, `Block_DB = 0x41`…);
 *  - `wireshark/epan/dissectors/packet-s7comm.c` — `S7COMM_ROSCTR_USERDATA 0x07`,
 *    `S7COMM_UD_FUNCGROUP_BLOCK 0x03`, `S7COMM_UD_SUBF_BLOCK_LIST 0x01` /
 *    `LISTTYPE 0x02` / `BLOCKINFO 0x03`, and the block-type codes as ASCII pairs
 *    (`0x3041` = `"0A"` = DB).
 *
 * They are recorded field by field in `docs/wui-eng-studio/S7-BROWSING.md`, which
 * is what makes them auditable — the same treatment
 * `VENDOR-ADDRESS-TRANSFORMATIONS.md` gives the `_datatype` tables.
 *
 * ⚠️ **Verification status: not yet run against a live S7-300/400.** The layouts
 * are transcribed and unit-tested against captured-shape fixtures
 * (`s7-protocol.spec.js`), and every parser refuses a frame that does not match
 * rather than returning a plausible value. See the doc's "Verification status".
 *
 * ## What the protocol cannot do, restated because it decides the feature
 *
 * There is **no symbolic browse**. A CPU answers block numbers and sizes; the
 * names, the types and the offsets live in the STEP 7 project and travel only in
 * its exports. Anything claiming to "browse the symbols of an S7-300" is reading
 * a project file somewhere. That is why the studio ingests the symbol table and
 * the AWL sources, and uses this client to check them.
 */

const net = require('node:net');

/** ISO-on-TCP well-known port (RFC 1006). */
const ISO_TCP_PORT = 102;

/** TPKT version byte — always 3 for RFC 1006. */
const TPKT_VERSION = 0x03;

/** COTP PDU types used here. */
const COTP_CONNECTION_REQUEST = 0xe0;
const COTP_CONNECTION_CONFIRM = 0xd0;
const COTP_DATA = 0xf0;
/** COTP DT: end-of-transmission bit of the `EoT + PDU number` byte. */
const COTP_EOT = 0x80;

/** S7 protocol id, first byte of every S7 header. */
const S7_PROTOCOL_ID = 0x32;
/** ROSCTR values (`packet-s7comm.c`). */
const ROSCTR_JOB = 0x01;
const ROSCTR_ACK_DATA = 0x03;
const ROSCTR_USERDATA = 0x07;

/** Function code of Setup Communication. */
const FUNC_NEGOTIATE = 0xf0;

/**
 * Userdata parameter "type + function group" byte: the high nibble is the type
 * (4 = request) and the low nibble the group. Snap7 spells the pair out as one
 * constant for exactly this reason.
 */
const GROUP_BLOCK_INFO = 0x43;
const GROUP_SZL = 0x44;

/** Userdata block subfunctions. */
const SUBFUNCTION_LIST_ALL = 0x01;
const SUBFUNCTION_LIST_OF_TYPE = 0x02;
const SUBFUNCTION_BLOCK_INFO = 0x03;
/** Userdata CPU subfunction: read a system-status list. */
const SUBFUNCTION_READ_SZL = 0x01;

/** Data-item transport size for an octet string. */
const TRANSPORT_OCTET_STRING = 0x09;
/** Data-item return code meaning "success". */
const RETURN_OK = 0xff;
/** Data-item return code a continuation request carries ("no data of my own"). */
const RETURN_NO_DATA = 0x0a;

/** Block type codes, transmitted as the ASCII pair `0x30` + this byte. */
const BLOCK_TYPE = { OB: 0x38, DB: 0x41, SDB: 0x42, FC: 0x43, SFC: 0x44, FB: 0x45, SFB: 0x46 };

/** Reverse of {@link BLOCK_TYPE}, for reading the "list all" answer. */
const BLOCK_KIND_OF_CODE = Object.fromEntries(Object.entries(BLOCK_TYPE).map(([kind, code]) => [code, kind]));

/**
 * CPU error codes worth naming (`s7_types.h`). Anything else is reported as its
 * hex code rather than as a guessed sentence — a wrong explanation of a PLC
 * refusal costs more than an unexplained one.
 */
const CPU_ERRORS = {
  0x0005: 'address out of range',
  0x0006: 'invalid transport size',
  0x000a: 'item not available',
  0x8104: 'function not available on this CPU',
  0x8500: 'data exceeds the negotiated PDU size',
  0xd209: 'item not available',
  0xd241: 'the block is protected — a password is required',
  0xd602: 'invalid password',
  0xdc01: 'invalid value'
};

/** Seconds between the Unix epoch and 1984-01-01, the S7 block-date origin. */
const S7_DATE_EPOCH_SECONDS = 441_763_200;

/** Raised for anything the PLC or the transport refused. */
class S7Error extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'S7Error';
    if (code !== undefined) this.code = code;
  }
}

/** Name a CPU error code, or report it as hex when the table does not know it. */
function cpuErrorText(code) {
  const known = CPU_ERRORS[code];
  return known === undefined ? `CPU error 0x${code.toString(16).padStart(4, '0')}` : `${known} (0x${code.toString(16).padStart(4, '0')})`;
}

/**
 * `YYYY-MM-DD` of an S7 block timestamp.
 *
 * The CPU reports a day count since 1984-01-01 plus a millisecond offset inside
 * that day. Both are used: dropping the milliseconds (as Snap7 does) is fine for
 * a date, but the time is what distinguishes two compilations on the same day,
 * and "was this block recompiled since the export?" is exactly the question.
 */
function s7Timestamp(days, milliseconds) {
  if (!Number.isFinite(days) || days === 0) return undefined;
  const seconds = S7_DATE_EPOCH_SECONDS + days * 86_400 + Math.floor((milliseconds || 0) / 1000);
  return new Date(seconds * 1000).toISOString();
}

/** Trim an ASCII field the CPU pads with spaces and NULs. */
function asciiField(buffer) {
  return buffer.toString('latin1').replaceAll('\u0000', ' ').trim();
}

/**
 * One S7 connection.
 *
 * Requests are serialised through a promise chain: S7comm is strictly
 * request/response over a single connection, and two overlapping exchanges would
 * read each other's answers. The caller therefore never has to think about it —
 * `await client.blockInfo(...)` inside a loop is correct.
 */
class S7Client {
  /**
   * @param {{host: string, port?: number, rack?: number, slot?: number,
   *          connectionType?: number, localTsap?: number, remoteTsap?: number,
   *          timeoutMs?: number, pduRequest?: number}} options
   */
  constructor(options) {
    if (!options || typeof options.host !== 'string' || options.host.trim() === '') {
      throw new S7Error('host is required');
    }
    this.host = options.host.trim();
    this.port = options.port || ISO_TCP_PORT;
    this.rack = options.rack === undefined ? 0 : Number(options.rack);
    this.slot = options.slot === undefined ? 2 : Number(options.slot);
    // 1 = PG (what STEP 7 itself uses), 2 = OP, 3 = basic. PG is the most
    // permissive for the diagnostic services this client calls.
    this.connectionType = options.connectionType === undefined ? 1 : Number(options.connectionType);
    this.localTsap = options.localTsap === undefined ? 0x0100 : Number(options.localTsap);
    this.remoteTsap =
      options.remoteTsap === undefined ? (this.connectionType << 8) + this.rack * 0x20 + this.slot : Number(options.remoteTsap);
    this.timeoutMs = options.timeoutMs || 5000;
    this.pduRequest = options.pduRequest || 480;

    this.socket = null;
    this.pduLength = 0;
    this.sequence = 0;
    /** Serialises exchanges; see the class comment. */
    this.queue = Promise.resolve();
    this.buffer = Buffer.alloc(0);
    /** Resolver of the exchange currently in flight. */
    this.pending = null;
  }

  /** Next PDU reference. Never 0 — some CPUs treat 0 as "no reference". */
  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xffff;
    if (this.sequence === 0) this.sequence = 1;
    return this.sequence;
  }

  /** Open the TCP connection, the COTP session and negotiate the PDU size. */
  async connect() {
    await this.openSocket();
    await this.cotpConnect();
    await this.negotiate();
    return { pduLength: this.pduLength };
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      const onError = (error) => {
        socket.destroy();
        reject(new S7Error(`cannot reach ${this.host}:${this.port} — ${error.message}`, 'unreachable'));
      };
      const timer = setTimeout(() => onError(new Error(`no answer within ${this.timeoutMs} ms`)), this.timeoutMs);
      socket.once('error', onError);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', onError);
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.failPending(new S7Error(`connection lost — ${error.message}`, 'lost')));
        socket.on('close', () => this.failPending(new S7Error('connection closed by the PLC', 'closed')));
        resolve();
      });
    });
  }

  /** Feed the TPKT reassembler; a complete frame resolves the pending exchange. */
  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 4) return;
      if (this.buffer[0] !== TPKT_VERSION) {
        this.failPending(new S7Error('not an ISO-on-TCP stream (bad TPKT version)'));
        return;
      }
      const length = this.buffer.readUInt16BE(2);
      if (length < 7 || length > 65_535) {
        this.failPending(new S7Error(`implausible TPKT length ${length}`));
        return;
      }
      if (this.buffer.length < length) return;
      const frame = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      const pending = this.pending;
      this.pending = null;
      if (pending !== null) {
        clearTimeout(pending.timer);
        pending.resolve(frame);
      }
    }
  }

  failPending(error) {
    const pending = this.pending;
    this.pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  /** Send one frame and await its answer. Serialised by {@link queue}. */
  exchange(frame) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (this.socket === null || this.socket.destroyed) {
          reject(new S7Error('not connected'));
          return;
        }
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new S7Error(`the PLC did not answer within ${this.timeoutMs} ms`, 'timeout'));
        }, this.timeoutMs);
        this.pending = { resolve, reject, timer };
        this.socket.write(frame);
      });
    // Keep the chain alive after a rejection, otherwise one failed request would
    // poison every later one on a connection that is still perfectly usable.
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** COTP connection request (`s7_isotcp.cpp`, `BuildControlPDU`). */
  async cotpConnect() {
    const parameters = Buffer.from([
      0xc0,
      0x01,
      0x0b, // TPDU size: Snap7's default (2048 bytes)
      0xc1,
      0x02,
      (this.localTsap >> 8) & 0xff,
      this.localTsap & 0xff,
      0xc2,
      0x02,
      (this.remoteTsap >> 8) & 0xff,
      this.remoteTsap & 0xff
    ]);
    const cotp = Buffer.alloc(7);
    cotp[0] = parameters.length + 6; // header length, excluding this byte
    cotp[1] = COTP_CONNECTION_REQUEST;
    cotp.writeUInt16BE(0x0000, 2); // destination reference
    cotp.writeUInt16BE(0x0001, 4); // source reference (Snap7 sends 00 01)
    cotp[6] = 0x00; // class/option — S7 wants 0, in disagreement with RFC 0983
    const frame = this.tpkt(Buffer.concat([cotp, parameters]));
    const answer = await this.exchange(frame);
    if (answer.length < 6 || answer[5] !== COTP_CONNECTION_CONFIRM) {
      throw new S7Error(
        `the PLC refused the ISO connection (rack ${this.rack}, slot ${this.slot}). Check the rack/slot: an S7-300 CPU is normally 0/2.`,
        'iso-refused'
      );
    }
  }

  /** Wrap a COTP payload in its TPKT header. */
  tpkt(payload) {
    const header = Buffer.alloc(4);
    header[0] = TPKT_VERSION;
    header[1] = 0x00;
    header.writeUInt16BE(payload.length + 4, 2);
    return Buffer.concat([header, payload]);
  }

  /** Wrap an S7 payload in COTP DT + TPKT. */
  frame(payload) {
    return this.tpkt(Buffer.concat([Buffer.from([0x02, COTP_DATA, COTP_EOT]), payload]));
  }

  /** Strip TPKT + COTP DT from an answer, leaving the S7 message. */
  static s7Of(frame) {
    if (frame.length < 7) throw new S7Error('truncated answer');
    const cotpLength = frame[4];
    const start = 4 + 1 + cotpLength;
    if (frame.length <= start) throw new S7Error('answer carries no S7 payload');
    const s7 = frame.subarray(start);
    if (s7[0] !== S7_PROTOCOL_ID) throw new S7Error('answer is not an S7 message');
    return s7;
  }

  /** Setup Communication — agrees the maximum PDU size (`s7_peer.cpp`). */
  async negotiate() {
    const header = this.s7Header(ROSCTR_JOB, 8, 0);
    const parameters = Buffer.alloc(8);
    parameters[0] = FUNC_NEGOTIATE;
    parameters[1] = 0x00;
    parameters.writeUInt16BE(0x0001, 2); // max AMQ caller
    parameters.writeUInt16BE(0x0001, 4); // max AMQ callee
    parameters.writeUInt16BE(this.pduRequest, 6);
    const answer = S7Client.s7Of(await this.exchange(this.frame(Buffer.concat([header, parameters]))));
    if (answer[1] !== ROSCTR_ACK_DATA || answer.length < 20) {
      throw new S7Error('the PLC refused the Setup Communication');
    }
    const error = answer.readUInt16BE(10);
    if (error !== 0) throw new S7Error(`Setup Communication refused: ${cpuErrorText(error)}`, 'negotiate');
    this.pduLength = answer.readUInt16BE(18);
    if (this.pduLength <= 0) throw new S7Error('the PLC negotiated a PDU length of 0');
    return this.pduLength;
  }

  /** The 10-byte request header shared by job and userdata messages. */
  s7Header(rosctr, parameterLength, dataLength) {
    const header = Buffer.alloc(10);
    header[0] = S7_PROTOCOL_ID;
    header[1] = rosctr;
    header.writeUInt16BE(0x0000, 2); // redundancy identification
    header.writeUInt16BE(this.nextSequence(), 4);
    header.writeUInt16BE(parameterLength, 6);
    header.writeUInt16BE(dataLength, 8);
    return header;
  }

  /**
   * Userdata request parameters.
   *
   * `plen = 4` is a first request; `plen = 8` adds the reserved + error words a
   * CONTINUATION carries. `method` is 0x11 on a first request and 0x12 on a
   * continuation of an SZL read — both transcribed from Snap7 rather than
   * rationalised, because the CPU checks them.
   */
  userdataParameters(group, subfunction, sequence, { continuation = false, method } = {}) {
    const parameters = Buffer.alloc(continuation ? 12 : 8);
    parameters[0] = 0x00;
    parameters[1] = 0x01;
    parameters[2] = 0x12;
    parameters[3] = continuation ? 0x08 : 0x04;
    parameters[4] = method === undefined ? 0x11 : method;
    parameters[5] = group;
    parameters[6] = subfunction;
    parameters[7] = sequence;
    if (continuation) {
      parameters.writeUInt16BE(0x0000, 8); // reserved
      parameters.writeUInt16BE(0x0000, 10); // error code
    }
    return parameters;
  }

  /**
   * Split a userdata ANSWER into its parameter and data parts.
   *
   * The answer's own `plen` says whether the parameters carry the reserved and
   * error words, so the split is read from the frame instead of assumed — a
   * hard-coded 12 would mis-slice the CPUs that answer with 8.
   */
  static userdataAnswer(s7) {
    if (s7.length < 12 || s7[1] !== ROSCTR_USERDATA) throw new S7Error('not a userdata answer');
    const parameterLength = s7.readUInt16BE(6);
    const dataLength = s7.readUInt16BE(8);
    const parameters = s7.subarray(10, 10 + parameterLength);
    const data = s7.subarray(10 + parameterLength, 10 + parameterLength + dataLength);
    if (parameters.length < 8) throw new S7Error('userdata answer carries no parameters');
    const error = parameters.length >= 12 ? parameters.readUInt16BE(10) : 0;
    if (error !== 0) throw new S7Error(cpuErrorText(error), 'cpu');
    return {
      sequence: parameters[7],
      /** Byte 9 is the "last data unit" flag: 0 = done, 1 = more follows. */
      more: parameters.length >= 10 && parameters[9] !== 0x00,
      data
    };
  }

  /** Send one userdata request and return its parsed answer. */
  async userdata(group, subfunction, data, options = {}) {
    const parameters = this.userdataParameters(group, subfunction, options.sequence || 0x00, options);
    const header = this.s7Header(ROSCTR_USERDATA, parameters.length, data.length);
    const answer = S7Client.s7Of(await this.exchange(this.frame(Buffer.concat([header, parameters, data]))));
    return S7Client.userdataAnswer(answer);
  }

  /**
   * How many blocks of each kind the CPU holds (`opListBlocks`).
   *
   * The cheapest question there is, and the one that says whether the rest is
   * worth asking: a CPU with 2 DBs and one with 900 call for different walks.
   */
  async listBlocks() {
    const { data } = await this.userdata(GROUP_BLOCK_INFO, SUBFUNCTION_LIST_ALL, Buffer.from([RETURN_NO_DATA, 0x00, 0x00, 0x00]));
    if (data.length < 4 || data[0] !== RETURN_OK) throw new S7Error('the CPU refused the block listing');
    const length = data.readUInt16BE(2);
    // 7 entries of 4 bytes. A CPU answering anything else is not answering this.
    if (length !== 28 || data.length < 4 + 28) throw new S7Error(`unexpected block-list length ${length}`);
    const counts = {};
    for (let index = 0; index < 7; index += 1) {
      const at = 4 + index * 4;
      const kind = BLOCK_KIND_OF_CODE[data[at + 1]];
      if (kind !== undefined) counts[kind] = data.readUInt16BE(at + 2);
    }
    return counts;
  }

  /**
   * Every block number of one kind (`opListBlocksOfType`).
   *
   * The answer is paged: the CPU sets the "last data unit" flag and hands back a
   * sequence number that every continuation must echo. `maxRequests` bounds the
   * walk so a CPU that never clears the flag cannot spin here forever — the same
   * "bounded and says so" rule the OPC UA walker follows.
   */
  async listBlocksOfType(kind, { maxRequests = 64 } = {}) {
    const code = BLOCK_TYPE[kind];
    if (code === undefined) throw new S7Error(`unknown block type '${kind}'`);
    const blocks = [];
    let sequence = 0x00;
    let first = true;
    let truncated = false;
    for (let request = 0; ; request += 1) {
      if (request >= maxRequests) {
        truncated = true;
        break;
      }
      const data = first
        ? Buffer.from([RETURN_OK, TRANSPORT_OCTET_STRING, 0x00, 0x02, 0x30, code])
        : Buffer.from([RETURN_NO_DATA, 0x00, 0x00, 0x00]);
      const answer = await this.userdata(GROUP_BLOCK_INFO, SUBFUNCTION_LIST_OF_TYPE, data, {
        sequence,
        continuation: !first
      });
      first = false;
      const payload = answer.data;
      if (payload.length < 4) break;
      if (payload[0] !== RETURN_OK) {
        // `item not available` on the FIRST page simply means "none of this kind".
        if (payload[0] === RETURN_NO_DATA && blocks.length === 0) break;
        throw new S7Error(`the CPU refused the ${kind} listing: ${cpuErrorText(payload[0])}`);
      }
      const length = payload.readUInt16BE(2);
      for (let at = 4; at + 4 <= 4 + length && at + 4 <= payload.length; at += 4) {
        blocks.push({ number: payload.readUInt16BE(at), language: payload[at + 3] });
      }
      sequence = answer.sequence;
      if (!answer.more) break;
    }
    return { blocks, truncated };
  }

  /**
   * Describe one block (`opAgBlockInfo`).
   *
   * For a data block `mc7Size` is the size of its DATA, which is the number the
   * cross-check needs: a catalog reading past it is reading past the end of the
   * block in the running PLC.
   */
  async blockInfo(kind, number) {
    const code = BLOCK_TYPE[kind];
    if (code === undefined) throw new S7Error(`unknown block type '${kind}'`);
    if (!Number.isInteger(number) || number < 0 || number > 65_535) throw new S7Error(`invalid block number ${number}`);
    const data = Buffer.alloc(12);
    data[0] = RETURN_OK;
    data[1] = TRANSPORT_OCTET_STRING;
    data.writeUInt16BE(0x0008, 2);
    data[4] = 0x30; // block prefix, ASCII '0'
    data[5] = code;
    data.write(String(number).padStart(5, '0'), 6, 5, 'latin1');
    data[11] = 0x41; // filesystem 'A' — the active (working memory) one
    const answer = await this.userdata(GROUP_BLOCK_INFO, SUBFUNCTION_BLOCK_INFO, data);
    const payload = answer.data;
    if (payload.length < 4) throw new S7Error('empty block-info answer');
    if (payload[0] !== RETURN_OK) throw new S7Error(cpuErrorText(payload[0]), 'block-info');
    const length = payload.readUInt16BE(2);
    // Snap7 refuses a declared length below 40; the check that actually matters
    // is that the buffer holds every field read below (the last ends at 74), so
    // a short answer is refused rather than read out of bounds.
    if (length < 40 || payload.length < 74) throw new S7Error(`truncated block-info answer (${length} bytes, ${payload.length} received)`);
    return {
      kind: BLOCK_KIND_OF_CODE[payload[4 + 11]] || kind,
      number: payload.readUInt16BE(4 + 12),
      flags: payload[4 + 9],
      language: payload[4 + 10],
      loadSize: payload.readUInt32BE(4 + 14),
      codeDate: s7Timestamp(payload.readUInt16BE(4 + 26), payload.readUInt32BE(4 + 22)),
      interfaceDate: s7Timestamp(payload.readUInt16BE(4 + 32), payload.readUInt32BE(4 + 28)),
      localDataSize: payload.readUInt16BE(4 + 38),
      mc7Size: payload.readUInt16BE(4 + 40),
      author: asciiField(payload.subarray(4 + 42, 4 + 50)),
      family: asciiField(payload.subarray(4 + 50, 4 + 58)),
      header: asciiField(payload.subarray(4 + 58, 4 + 66)),
      // Conventional MC7 block-version encoding: major in the high nibble, minor
      // in the low one. The raw byte rides along so a CPU that encodes it
      // otherwise can be diagnosed instead of silently mis-reported.
      version: `${(payload[4 + 66] >> 4) & 0x0f}.${payload[4 + 66] & 0x0f}`,
      versionByte: payload[4 + 66],
      checksum: payload.readUInt16BE(4 + 68)
    };
  }

  /**
   * Read a system-status list (`opReadSZL`).
   *
   * Returns the raw records with the record length the CPU itself declares, so
   * the caller slices by the CPU's own answer rather than by a hard-coded record
   * size that varies between SZL ids and firmware versions.
   */
  async readSzl(id, index = 0x0000, { maxRequests = 32 } = {}) {
    const chunks = [];
    let recordLength = 0;
    let recordCount = 0;
    let sequence = 0x00;
    let first = true;
    for (let request = 0; request < maxRequests; request += 1) {
      let data;
      if (first) {
        data = Buffer.alloc(8);
        data[0] = RETURN_OK;
        data[1] = TRANSPORT_OCTET_STRING;
        data.writeUInt16BE(0x0004, 2);
        data.writeUInt16BE(id, 4);
        data.writeUInt16BE(index, 6);
      } else {
        data = Buffer.from([RETURN_NO_DATA, 0x00, 0x00, 0x00]);
      }
      const answer = await this.userdata(GROUP_SZL, SUBFUNCTION_READ_SZL, data, {
        sequence,
        continuation: !first,
        ...(first ? {} : { method: 0x12 })
      });
      const payload = answer.data;
      if (payload.length < 4) break;
      if (payload[0] !== RETURN_OK) throw new S7Error(`SZL 0x${id.toString(16).padStart(4, '0')}: ${cpuErrorText(payload[0])}`, 'szl');
      if (first) {
        if (payload.length < 12) throw new S7Error('truncated SZL answer');
        recordLength = payload.readUInt16BE(8);
        recordCount = payload.readUInt16BE(10);
        chunks.push(payload.subarray(12));
      } else {
        chunks.push(payload.subarray(4));
      }
      first = false;
      sequence = answer.sequence;
      if (!answer.more) break;
    }
    const body = Buffer.concat(chunks);
    const records = [];
    if (recordLength > 0) {
      for (let at = 0; at + recordLength <= body.length && records.length < recordCount; at += recordLength) {
        records.push(body.subarray(at, at + recordLength));
      }
    }
    return { recordLength, recordCount, records };
  }

  /** Close the connection. Idempotent. */
  close() {
    if (this.socket !== null) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.failPending(new S7Error('connection closed'));
  }
}

module.exports = {
  S7Client,
  S7Error,
  BLOCK_TYPE,
  BLOCK_KIND_OF_CODE,
  ISO_TCP_PORT,
  cpuErrorText,
  s7Timestamp,
  asciiField
};
