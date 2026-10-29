// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Domain types for the Process Monitor page. */

/**
 * One pmon-managed manager (from the backend `ListManagers`): its `config/progs` entry
 * (`MGRLIST:LIST`) merged with its live status (`MGRLIST:STATI`).
 */
export interface ManagerInfo {
  /** pmon index (0-based). */
  index: number;
  name: string;
  options: string;
  /** Configured start mode (`config/progs`): 'manual' | 'once' | 'always' ('' when unknown). */
  startModeCfg: string;
  /** Seconds pmon waits before killing the manager on stop. */
  secKill: number;
  /** Restarts allowed within `resetMin` minutes. */
  restartCount: number;
  /** Minutes after which the restart counter is reset. */
  resetMin: number;
  /** Live state code (0 stopped, 1 init, 2 running, 3 blocked). */
  state: number;
  stateLabel: string;
  pid: number;
  /** Live start mode code (0 manual, 1 once, 2 always). */
  startMode: number;
  /**
   * Start time: ISO 8601 when the manager could read pmon's text, pmon's raw text
   * otherwise, '' when pmon gives none (stopped / never started).
   */
  startTime: string;
  /** Manager number (`-num`) the manager runs with. */
  manNum: number;
}

/** pmon start modes for a configured manager. */
export type ManagerStartMode = 'manual' | 'once' | 'always';

/** Spec of a manager to ADD to the pmon configuration (config/progs). */
export interface ManagerSpec {
  /** Executable name without .exe (e.g. WCCOActrl, node). */
  name: string;
  startMode: ManagerStartMode;
  /** Command line options (e.g. "-f script.ctl"). */
  options: string;
  /** Insert position in the pmon list (0 is pmon itself); omit to append. */
  index?: number;
}

/** One connected server/system and its live manager list (one tab per instance). */
export interface Instance {
  /** WinCC OA system name, e.g. "System1:" (empty on a standalone system). */
  system: string;
  /** Host name of that server. */
  hostname: string;
  /** ISO timestamp of the last published snapshot. */
  updated: string;
  /** Managers running on that server. */
  managers: ManagerInfo[];
  /** Full node DP name backing this instance. */
  dp: string;
}

/** Project folders whose contents may be purged before a deploy. */
export type PurgeableFolder = 'data/dashboard-wc' | 'scripts' | 'javascript' | 'panels' | 'pictures';

export const PURGEABLE_FOLDERS: PurgeableFolder[] = ['data/dashboard-wc', 'scripts', 'javascript', 'panels', 'pictures'];

/**
 * Purgeable folders that host the RUNNING webserver + processMonitor manager
 * (`javascript/`). Clearing them mid-deploy wipes the code executing the deploy
 * — only safe if the ZIP restores a working `javascript/` and the project is
 * restarted. The UI surfaces an extra warning for these.
 */
export const SELF_HOSTING_FOLDERS: string[] = ['javascript'];

/** Top-level project folders a ZIP can NEVER be extracted into (backend-enforced). */
export const PROTECTED_FOLDERS: string[] = ['logs', 'log', 'db', 'config', 'images', 'bin'];

/** Per-server outcome of a deploy. */
export interface DeployServerResult {
  system: string;
  hostname: string;
  ok: boolean;
  cleared?: string[];
  /** Protected folders skipped during extraction (never overwritten). */
  skipped?: string[];
  error?: string;
}

/** Result of a project deploy (possibly across several servers). */
export interface DeployResult {
  ok: boolean;
  results?: DeployServerResult[];
  error?: string;
}

/** One row in the operations history (project import / manager restart). */
export interface HistoryEntry {
  /** ISO timestamp. */
  time: string;
  /** Operation kind. */
  action: 'deploy' | 'restart-all' | 'manager' | 'logs-export';
  /** Human-readable detail (file name, manager name, …). */
  detail: string;
  /** 'success' | 'failed'. */
  status: 'success' | 'failed';
  /** Host that served the request. */
  host: string;
  /** Connected user that performed the operation (filled by `traceOperation`). */
  user?: string;
  /** Target system name (multi-server); empty/undefined for the local system. */
  system?: string;
}

/** One log file of a host's `<project>/log` (backend `ListLogs`). */
export interface LogFileInfo {
  name: string;
  size: number;
  /** ISO last-modified date. */
  mtime: string;
  /** Its previous rotation (`.bak`) in the folder, '' when none. */
  bak: string;
  /** For a `.bak`: the current log it rotates, '' otherwise. */
  bakOf: string;
  /** The manager it belongs to, deduced from its name (+ pmon index), null for a shared log. */
  manager: { name: string; manNum: number | null; index: number | null } | null;
}

/** One file of a `ReadLog` / `ExportLog` reply. */
export interface LogReadFile {
  name: string;
  /** Complete lines read (a line being written waits for the next read). */
  text: string;
  /** Byte offset the next incremental read starts at. */
  offset: number;
  size: number;
  /** Older content was left out (tail, or the whole-read cap). */
  truncated: boolean;
  /** The text replaces what was read before (first read, or the file was rotated). */
  reset: boolean;
  /** The previous rotation, sent with a fresh read when asked (`mergeBak`). */
  bak?: { name: string; text: string; truncated: boolean };
}
