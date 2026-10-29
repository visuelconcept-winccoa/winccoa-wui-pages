// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pmon TCP client (ported from the WinCC OA MCP server's PmonClient) — talks to
 * the local Process Monitor over TCP (default localhost:4999) to list managers,
 * start / stop / restart them, add / remove entries in the pmon configuration
 * (SINGLE_MGR:INS / SINGLE_MGR:DEL, persisted to config/progs by pmon), plus
 * restart the whole project.
 */
'use strict';
const net = require('node:net');

const DEFAULT_PORT = 4999;
const DEFAULT_TIMEOUT_MS = 5000;

class PmonClient {
  constructor(config = {}) {
    this.host = config.host || process.env.WINCCOA_PMON_HOST || 'localhost';
    this.port = config.port || Number.parseInt(process.env.WINCCOA_PMON_PORT || String(DEFAULT_PORT), 10);
    this.user = config.user || process.env.WINCCOA_PMON_USER || '';
    this.password = config.password || process.env.WINCCOA_PMON_PASSWORD || '';
    this.timeout = config.timeout || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Send one MGRLIST query, resolve with the raw response. These responses are
   * terminated with `;` (or `\n;`), so we can resolve as soon as it arrives.
   */
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let response = '';
      let dataReceived = false;
      const authPrefix = this.user || this.password ? `${this.user}#${this.password}#` : '##';
      const full = authPrefix + command;
      const to = setTimeout(() => {
        client.destroy();
        if (dataReceived && response.length > 0) resolve(response);
        else reject(new Error(`Pmon timeout after ${this.timeout}ms`));
      }, this.timeout);
      client.connect(this.port, this.host, () => client.write(full + '\n'));
      client.on('data', (d) => {
        dataReceived = true;
        response += d.toString();
        if (response.includes('\n;') || response.endsWith(';')) {
          clearTimeout(to);
          client.end();
          resolve(response);
        }
      });
      client.on('end', () => {
        clearTimeout(to);
        if (dataReceived) resolve(response);
      });
      client.on('error', (err) => {
        clearTimeout(to);
        reject(new Error(`Pmon connection error: ${err.message}`));
      });
    });
  }

  /**
   * Send one SINGLE_MGR / RESTART_ALL control command. Unlike MGRLIST queries,
   * pmon does NOT terminate these replies with `;` — a successful command is
   * often acknowledged with NOTHING at all. So instead of waiting for a
   * terminator (which forces a full timeout and a false failure on a silent OK),
   * we collect whatever arrives within a short quiet window and resolve with it.
   * Resolves with the (possibly empty) response text; rejects only on a socket
   * error — interpretation of an `ERROR …` payload is the caller's job.
   */
  sendControl(command) {
    const quietMs = 600;
    const capMs = Math.min(this.timeout, 3000);
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let response = '';
      let quiet = null;
      const authPrefix = this.user || this.password ? `${this.user}#${this.password}#` : '##';
      const finish = () => {
        clearTimeout(quiet);
        clearTimeout(cap);
        client.destroy();
        resolve(response);
      };
      const cap = setTimeout(finish, capMs);
      const armQuiet = () => {
        clearTimeout(quiet);
        quiet = setTimeout(finish, quietMs);
      };
      client.connect(this.port, this.host, () => {
        client.write(authPrefix + command + '\n');
        armQuiet(); // a silent OK never sends data → resolve after the quiet window
      });
      client.on('data', (d) => {
        response += d.toString();
        if (response.includes('\n;') || response.endsWith(';')) finish();
        else armQuiet();
      });
      client.on('end', finish);
      client.on('error', (err) => {
        clearTimeout(quiet);
        clearTimeout(cap);
        reject(new Error(`Pmon connection error: ${err.message}`));
      });
    });
  }

  /**
   * Managers with their configuration (`MGRLIST:LIST`: start mode, secKill, restart count,
   * reset minutes, options) merged with their live status (`MGRLIST:STATI`: state, pid, live
   * start mode, start time, manager number). `startTime` is ISO 8601 when pmon's text could
   * be read (pmon and this manager share the host, so its local time is ours), pmon's raw
   * text otherwise, and '' when pmon gives none.
   */
  async listManagers() {
    const [listRaw, statRaw] = await Promise.all([
      this.sendCommand('MGRLIST:LIST'),
      this.sendCommand('MGRLIST:STATI')
    ]);
    return mergeManagers(parseList(listRaw), parseStati(statRaw));
  }

  async startManager(index) {
    return interpretControl(await this.sendControl(`SINGLE_MGR:START ${index}`));
  }
  async stopManager(index) {
    return interpretControl(await this.sendControl(`SINGLE_MGR:STOP ${index}`));
  }
  /** Restart one manager: STOP then START (pmon index is 0-based). */
  async restartManager(index) {
    await this.sendControl(`SINGLE_MGR:STOP ${index}`);
    await delay(1000);
    // An "always"-mode manager may have been auto-restarted by pmon during the
    // delay, so START can answer "not possible" — that is benign for a restart.
    return interpretControl(await this.sendControl(`SINGLE_MGR:START ${index}`));
  }
  /** Restart every manager in the project. */
  async restartAll() {
    return interpretControl(await this.sendControl('RESTART_ALL:'));
  }
  /**
   * Insert a manager into the pmon configuration at `index` (same 0-based list
   * index space as MGRLIST — index 0 is pmon itself, so `index` must be ≥ 1;
   * `index === list length` appends). pmon persists the change to config/progs.
   */
  async addManager({ index, name, startMode = 'always', secKill = 30, restartCount = 3, resetMin = 1, options = '' }) {
    const before = await this.listManagers();
    const text = interpretConfig(
      await this.sendControl(`SINGLE_MGR:INS ${index} ${name} ${startMode} ${secKill} ${restartCount} ${resetMin} ${options}`.trimEnd())
    );
    // pmon often acknowledges with NOTHING: an ignored insert would read as a success.
    // The list is re-read and must hold the new entry at its index (issue 35).
    const failure = checkInserted(before, await this.listManagers(), { index, name, options });
    if (failure) throw new Error(`${failure}${text ? ` (pmon : ${text.slice(0, 120)})` : ''}`);
    return text;
  }
  /** Remove a (stopped) manager from the pmon configuration (index ≥ 1). */
  async removeManager(index) {
    const before = await this.listManagers();
    const text = interpretConfig(await this.sendControl(`SINGLE_MGR:DEL ${index}`));
    const failure = checkRemoved(before, await this.listManagers(), index);
    if (failure) throw new Error(`${failure}${text ? ` (pmon : ${text.slice(0, 120)})` : ''}`);
    return text;
  }
}

/**
 * Interpret a SINGLE_MGR / RESTART_ALL reply. pmon either acknowledges silently
 * (empty) or returns an `ERROR …` line. A "not possible" refusal is benign — it
 * means the always-mode manager is already (re)started — so only a genuine error
 * is raised; otherwise the trimmed text is returned for logging.
 */
function interpretControl(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/\berror\b/i.test(text) && !/not possible|already/i.test(text)) {
    throw new Error(text.slice(0, 200));
  }
  return text;
}

/**
 * Interpret a SINGLE_MGR:INS / SINGLE_MGR:DEL reply. Unlike start/stop, a
 * "not possible" refusal is a REAL failure here (e.g. deleting a running
 * manager, inserting at an occupied running slot) — any ERROR text is raised.
 */
function interpretConfig(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/\berror\b/i.test(text) || /not possible/i.test(text)) {
    throw new Error(text.slice(0, 200));
  }
  return text;
}

const sameOptions = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();

/**
 * Check a `SINGLE_MGR:INS` against the pmon list read before and after it: one entry more,
 * the new one at `index` with the same name and options. Returns the failure text, or ''.
 */
function checkInserted(before, after, { index, name, options }) {
  const at = after[index];
  if (after.length !== before.length + 1 || !at || at.name !== name || !sameOptions(at.options, options)) {
    return `pmon n'a pas ajouté ${name} en position ${index} (liste : ${before.length} → ${after.length} entrées)`;
  }
  return '';
}

/**
 * Check a `SINGLE_MGR:DEL` the same way: one entry less, and the removed entry no longer at
 * its index. Returns the failure text, or ''.
 */
function checkRemoved(before, after, index) {
  const gone = before[index];
  const stillThere = gone && after[index] && after[index].name === gone.name && sameOptions(after[index].options, gone.options) && after.length === before.length;
  if (after.length !== before.length - 1 || stillThere) {
    return `pmon n'a pas supprimé l'entrée ${index}${gone ? ` (${gone.name})` : ''} (liste : ${before.length} → ${after.length} entrées)`;
  }
  return '';
}

/**
 * Manager lines of a `config/progs` file (`manager | start | secKill | restart# | resetMin | options`),
 * pmon itself first — the same order and index space as `MGRLIST:LIST`. Comments (`#`), the
 * header and the `auth` / `version` lines are skipped.
 */
function parseProgs(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('|')) continue;
    const p = line.split('|').map((c) => c.trim());
    if (p.length < 6 || !p[0]) continue;
    out.push({ name: p[0], startMode: p[1], secKill: p[2], restartCount: p[3], resetMin: p[4], options: p.slice(5).join('|') });
  }
  return out;
}

/** True when `config/progs` holds exactly the pmon list: same names and options, same order. */
function progsMatches(progs, list) {
  return progs.length === list.length && list.every((m, i) => progs[i].name === m.name && sameOptions(progs[i].options, m.options));
}

/** pmon state codes → label. */
const STATE_LABELS = { 0: 'stopped', 1: 'init', 2: 'running', 3: 'blocked' };

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Integer of a pmon column, or `def` when the column is empty / not a number. */
function intOr(text, def) {
  const n = Number.parseInt(String(text ?? '').trim(), 10);
  return Number.isInteger(n) ? n : def;
}

/** pmon start modes: the numeric codes some replies carry → the words of `config/progs`. */
const START_MODE_WORDS = { 0: 'manual', 1: 'once', 2: 'always' };

/** A start mode column as `manual` / `once` / `always` — pmon may send the code or the word. */
function startModeWord(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return START_MODE_WORDS[Number(t)] || t;
  return t;
}

/**
 * `MGRLIST:LIST` reply → configured entries. One line per manager after the `LIST:<n>`
 * header: `manager;startMode;secKill;restartCount;resetMin;options` (the options may hold
 * `;` themselves, so everything after column 5 is joined back).
 */
function parseList(response) {
  const lines = String(response || '').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line || line === ';') continue;
    const p = line.split(';');
    if (p.length >= 5) {
      out.push({
        index: i - 1,
        manager: p[0] || '',
        startMode: startModeWord(p[1]),
        secKill: intOr(p[2], 0),
        restartCount: intOr(p[3], 0),
        resetMin: intOr(p[4], 0),
        commandlineOptions: p.slice(5).join(';')
      });
    }
  }
  return out;
}

/**
 * `MGRLIST:STATI` reply → live status per manager: `state;pid;startMode;startTime;manNum`.
 * The closing line pmon appends (the project's mode, ending with `;`) is skipped.
 */
function parseStati(response) {
  const lines = String(response || '').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line || line.endsWith(';')) continue;
    const p = line.split(';');
    if (p.length >= 5) {
      out.push({
        state: intOr(p[0], 0),
        pid: intOr(p[1], 0),
        startMode: intOr(p[2], 0),
        startTime: (p[3] || '').trim(),
        manNum: intOr(p[4], 0)
      });
    }
  }
  return out;
}

/**
 * pmon's start time (text, in the host's local time) → ISO 8601. pmon writes
 * `2026.10.29 10:12:33.123`; `-` or `/` separators, a `T`, no seconds / milliseconds and a
 * day-first date (`29.10.2026 10:12:33`) are accepted too. Returns '' for no time — empty,
 * or the 1970 epoch pmon shows for a manager that never ran — and the raw text when it
 * cannot be read, so the page can still show it.
 */
function parsePmonTime(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const time = '[ T]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,6}))?)?';
  let y;
  let mo;
  let d;
  let rest;
  let m = raw.match(new RegExp(`^(\\d{4})[./-](\\d{1,2})[./-](\\d{1,2})${time}`));
  if (m) [, y, mo, d, ...rest] = m;
  else {
    m = raw.match(new RegExp(`^(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})${time}`));
    if (!m) return raw;
    [, d, mo, y, ...rest] = m;
  }
  const [h, mi, sec = '0', frac = '0'] = rest;
  const ms = Number.parseInt(String(frac).padEnd(3, '0').slice(0, 3), 10);
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), ms);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1) return raw;
  if (date.getFullYear() <= 1970) return '';
  return date.toISOString();
}

/** Configuration (`parseList`) + live status (`parseStati`), by position → the `ManagerInfo` shape. */
function mergeManagers(list, stat) {
  return list.map((m, i) => {
    const s = stat[i];
    const state = s?.state ?? 0;
    return {
      index: m.index,
      name: m.manager,
      options: m.commandlineOptions,
      startModeCfg: m.startMode,
      secKill: m.secKill,
      restartCount: m.restartCount,
      resetMin: m.resetMin,
      state,
      stateLabel: STATE_LABELS[state] || 'unknown',
      pid: s?.pid ?? -1,
      startMode: s?.startMode ?? 0,
      startTime: parsePmonTime(s?.startTime),
      manNum: s?.manNum ?? 0
    };
  });
}

module.exports = { PmonClient, checkInserted, checkRemoved, mergeManagers, parseList, parsePmonTime, parseProgs, parseStati, progsMatches };
