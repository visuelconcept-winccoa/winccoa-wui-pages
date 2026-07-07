// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Domain types for the Process Monitor page. */

/** One pmon-managed manager (from the backend `ListManagers`). */
export interface ManagerInfo {
  /** pmon index (0-based). */
  index: number;
  name: string;
  options: string;
  /** Live state code (0 stopped, 1 init, 2 running, 3 blocked). */
  state: number;
  stateLabel: string;
  pid: number;
  startMode: number;
  startTime: string;
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
export type PurgeableFolder = 'data/dashboard-wc' | 'scripts' | 'panels' | 'pictures';

export const PURGEABLE_FOLDERS: PurgeableFolder[] = ['data/dashboard-wc', 'scripts', 'panels', 'pictures'];

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
  action: 'deploy' | 'restart-all' | 'manager';
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
