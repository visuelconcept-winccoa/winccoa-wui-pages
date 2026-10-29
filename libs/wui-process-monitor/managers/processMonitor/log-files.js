// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Log files of the project, for the Logs tab of the Process Monitor page (issue 37).
 * Served by the agent of the host that owns the files, through its vRPC service:
 *
 *   ListLogs()                                      -> { ok, files: [{name, size, mtime, bak, manager}] }
 *   ReadLog({files, fromOffset, maxLines, mergeBak}) -> { ok, files: [{name, text, offset, size, truncated, reset, bak?}] }
 *   ExportLog({files, mergeBak})                     -> same as ReadLog, whole files
 *
 * - Only `<project>/log` is read, and only the files found there: a requested name is
 *   checked against the listing, never used as a path (no traversal).
 * - `maxLines > 0` and no `fromOffset`: the last lines of the file, read from the END in
 *   blocks — a multi-MB log is never loaded for a live tail.
 * - `fromOffset[name]`: what was written since that byte offset (the live tail), up to the
 *   last complete line; `offset` in the reply is where the next read starts. A file shorter
 *   than the offset was rotated: its tail is sent again with `reset: true`.
 * - `maxLines` 0: the whole file (pause / export), capped at READ_CAP_BYTES from its end
 *   (`truncated: true`).
 * - `mergeBak`: the previous rotation (`<name>.bak`, or `<base>.bak`) is sent along as `bak`
 *   (`{name, text, truncated}`), whole or for the lines the current file lacks.
 * - Text is UTF-8, or Latin-1 when the bytes are not valid UTF-8 (a non-UTF-8 project).
 *
 * Pure Node (no winccoa-manager) — unit-tested in test/log-files.test.mjs.
 */
'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Log file names served: `.log`, and their rotations `.bak` / `.log.bak`. */
const LOG_NAME = /^[^/\\]+\.(log|bak)$/i;
/** Block size of the backwards tail read. */
const BLOCK_BYTES = 64 * 1024;
/** Most text one file sends in a read (whole file / big increment), from its end. */
const READ_CAP_BYTES = 8 * 1024 * 1024;
/** Most lines a tail asks for. */
const MAX_TAIL_LINES = 20000;

/** Decode as UTF-8, or Latin-1 when the bytes are not valid UTF-8. */
function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

/** The current log a `.bak` rotates: `X.log.bak` / `X.bak` → `X.log`; '' for a `.log`. */
function bakBase(name) {
  if (/\.log\.bak$/i.test(name)) return name.slice(0, -4);
  if (/\.bak$/i.test(name)) return `${name.slice(0, -4)}.log`;
  return '';
}

/**
 * The manager a log file belongs to, from its name: `WCCOActrl3.log` → WCCOActrl -num 3,
 * `node_5.log` → the JavaScript manager -num 5, `WCCILpmon.log` → pmon. `managers` (the pmon
 * list, optional) adds the pmon index. null for a shared log (`PVSS_II.log`) or an unknown name.
 */
function managerOfLog(name, managers = []) {
  const base = name.replace(/(\.log)?(\.bak)?$/i, '');
  if (/^PVSS_II$/i.test(base) || /^WinCC_OA$/i.test(base)) return null;
  const m = base.match(/^([A-Za-z][\w.-]*?)_?(\d+)?$/);
  if (!m) return null;
  let exe = m[1];
  const num = m[2] === undefined ? null : Number(m[2]);
  const names = exe.toLowerCase() === 'node' ? ['node', 'WCCOAjavascript'] : [exe];
  const entry = managers.find((x) => names.some((n) => n.toLowerCase() === String(x.name).toLowerCase()) && (num === null || x.manNum === num));
  if (exe.toLowerCase() === 'node') exe = entry?.name || 'WCCOAjavascript';
  return { name: entry?.name || exe, manNum: num ?? entry?.manNum ?? null, index: entry ? entry.index : null };
}

/** The log files of `logDir` (sorted by name), with the `.bak` of each and its manager. */
async function listLogFiles(logDir, managers = []) {
  let dirents = [];
  try {
    dirents = await fsp.readdir(logDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const d of dirents) {
    if (!d.isFile() || !LOG_NAME.test(d.name)) continue;
    try {
      const st = await fsp.stat(path.join(logDir, d.name));
      files.push({ name: d.name, size: st.size, mtime: st.mtime.toISOString() });
    } catch {
      // vanished between readdir and stat (rotation): skip
    }
  }
  const names = new Set(files.map((f) => f.name));
  for (const f of files) {
    const base = bakBase(f.name);
    f.bakOf = base && names.has(base) ? base : '';
    f.bak = f.bakOf ? '' : [`${f.name}.bak`, f.name.replace(/\.log$/i, '.bak')].find((b) => b !== f.name && names.has(b)) || '';
    f.manager = managerOfLog(f.name, managers);
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read `length` bytes at `position` of an open file. */
async function readAt(handle, position, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/**
 * The last `maxLines` lines before byte `end`, read backwards in blocks. Resolves with their
 * bytes and `truncated` when the file holds more before them.
 */
async function tailLines(handle, end, maxLines) {
  let start = end;
  let chunks = [];
  let newlines = 0;
  while (start > 0 && newlines <= maxLines && end - start < READ_CAP_BYTES) {
    const len = Math.min(BLOCK_BYTES, start);
    start -= len;
    const buf = await readAt(handle, start, len);
    chunks.unshift(buf);
    for (const byte of buf) if (byte === 0x0a) newlines += 1;
  }
  let buf = Buffer.concat(chunks);
  chunks = null;
  // Keep the last maxLines lines (a trailing newline closes the last one).
  let cut = buf.length;
  if (cut > 0 && buf[cut - 1] === 0x0a) cut -= 1;
  let seen = 0;
  let from = 0;
  for (let i = cut - 1; i >= 0; i--) {
    if (buf[i] === 0x0a && ++seen === maxLines) {
      from = i + 1;
      break;
    }
  }
  const truncated = from > 0 || start > 0;
  return { buf: buf.subarray(from), truncated };
}

/** Up to the last complete line of `buf` (a line being written is left for the next read). */
function completeLines(buf) {
  const last = buf.lastIndexOf(0x0a);
  return last < 0 ? buf.subarray(0, 0) : buf.subarray(0, last + 1);
}

/**
 * One file: tail, increment from an offset, or whole (see the header). With `complete`
 * (a file being written), a last line without its newline is left for the next read and
 * `offset` points at its start; a `.bak` (rotated, final) is sent whole.
 */
async function readOne(file, { fromOffset, maxLines, complete = true }) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (Number.isInteger(fromOffset) && fromOffset >= 0 && fromOffset <= size) {
      const length = size - fromOffset;
      if (length <= READ_CAP_BYTES) {
        const buf = completeLines(await readAt(handle, fromOffset, length));
        return { text: decode(buf), offset: fromOffset + buf.length, size, truncated: false, reset: false };
      }
      // Too much since the last read: start over from the tail.
    }
    const reset = Number.isInteger(fromOffset);
    let buf;
    let truncated;
    if (maxLines > 0) {
      ({ buf, truncated } = await tailLines(handle, size, Math.min(maxLines, MAX_TAIL_LINES)));
    } else {
      const start = Math.max(0, size - READ_CAP_BYTES);
      buf = await readAt(handle, start, size - start);
      if (start > 0) buf = buf.subarray(buf.indexOf(0x0a) + 1); // drop the cut first line
      truncated = start > 0;
    }
    const kept = complete ? completeLines(buf) : buf;
    return { text: decode(kept), offset: size - (buf.length - kept.length), size, truncated, reset };
  } finally {
    await handle.close();
  }
}

/** Number of lines of a text (a trailing newline does not open a new one). */
function countLines(text) {
  if (!text) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1;
  return text.endsWith('\n') ? n : n + 1;
}

/**
 * Read the requested log files of `logDir`. `files` must all be in the listing; the reply
 * keeps their order. See the header for the modes.
 */
async function readLogFiles(logDir, { files, fromOffset, maxLines, mergeBak } = {}) {
  const requested = Array.isArray(files) ? files.map(String) : [];
  if (requested.length === 0) return { ok: false, error: 'files required' };
  const listing = await listLogFiles(logDir);
  const known = new Map(listing.map((f) => [f.name, f]));
  const unknown = requested.filter((n) => !known.has(n));
  if (unknown.length > 0) return { ok: false, error: `unknown log file: ${unknown.join(', ')}` };
  const offsets = fromOffset && typeof fromOffset === 'object' ? fromOffset : {};
  const lines = Number.isInteger(maxLines) && maxLines > 0 ? maxLines : 0;
  const out = [];
  for (const name of requested) {
    const from = offsets[name];
    const r = await readOne(path.join(logDir, name), { fromOffset: from, maxLines: lines });
    const entry = { name, ...r };
    const bakName = known.get(name).bak;
    // The .bak goes with a fresh read only — an increment continues the current file.
    const fresh = !Number.isInteger(from) || r.reset;
    if (mergeBak && bakName && fresh) {
      const missing = lines > 0 ? lines - countLines(r.text) : 0;
      if (lines === 0 || missing > 0) {
        const b = await readOne(path.join(logDir, bakName), { maxLines: missing, complete: false });
        entry.bak = { name: bakName, text: b.text, truncated: b.truncated };
      }
    }
    out.push(entry);
  }
  return { ok: true, files: out };
}

module.exports = { BLOCK_BYTES, READ_CAP_BYTES, bakBase, listLogFiles, managerOfLog, readLogFiles };
