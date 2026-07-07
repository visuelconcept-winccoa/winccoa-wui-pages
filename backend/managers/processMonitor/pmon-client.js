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

  /** Managers with config (name/startMode) merged with live status (state/pid/manNum). */
  async listManagers() {
    const [listRaw, statRaw] = await Promise.all([
      this.sendCommand('MGRLIST:LIST'),
      this.sendCommand('MGRLIST:STATI')
    ]);
    const list = parseList(listRaw);
    const stat = parseStati(statRaw);
    return list.map((m, i) => ({
      index: m.index,
      name: m.manager,
      options: m.commandlineOptions,
      startModeCfg: m.startMode,
      state: stat[i]?.state ?? 0,
      stateLabel: STATE_LABELS[stat[i]?.state ?? 0] || 'unknown',
      pid: stat[i]?.pid ?? -1,
      startMode: stat[i]?.startMode ?? 0,
      startTime: stat[i]?.startTime ?? '',
      manNum: stat[i]?.manNum ?? 0
    }));
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
    return interpretConfig(
      await this.sendControl(`SINGLE_MGR:INS ${index} ${name} ${startMode} ${secKill} ${restartCount} ${resetMin} ${options}`.trimEnd())
    );
  }
  /** Remove a (stopped) manager from the pmon configuration (index ≥ 1). */
  async removeManager(index) {
    return interpretConfig(await this.sendControl(`SINGLE_MGR:DEL ${index}`));
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

/** pmon state codes → label. */
const STATE_LABELS = { 0: 'stopped', 1: 'init', 2: 'running', 3: 'blocked' };

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseList(response) {
  const lines = response.trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line || line === ';') continue;
    const p = line.split(';');
    if (p.length >= 5) {
      out.push({
        index: i - 1,
        manager: p[0] || '',
        startMode: p[1] || '',
        commandlineOptions: p.slice(5).join(';')
      });
    }
  }
  return out;
}

function parseStati(response) {
  const lines = response.trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || '').trim();
    if (!line || line.endsWith(';')) continue;
    const p = line.split(';');
    if (p.length >= 5) {
      out.push({
        state: Number.parseInt(p[0] || '0', 10),
        pid: Number.parseInt(p[1] || '0', 10),
        startMode: Number.parseInt(p[2] || '0', 10),
        startTime: p[3] || '',
        manNum: Number.parseInt(p[4] || '0', 10)
      });
    }
  }
  return out;
}

module.exports = { PmonClient };
