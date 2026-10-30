// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The shapes of `/api/users` (the usersService manager's answers). */

/** 32 permission bits, level 1 first. */
export type PermissionBits = boolean[];

export interface OaUser {
  id: number;
  name: string;
  fullName: string;
  comment: string;
  enabled: boolean;
  language: string;
  /** Set for a user of the Active Directory (its external id); '' for a local user. */
  osId: string;
  domain: string;
  groupIds: number[];
}

export interface GroupArea {
  id: number;
  permissions: PermissionBits;
}

export interface OaGroup {
  id: number;
  name: string;
  fullName: string;
  comment: string;
  /** Set for a group imported from the Active Directory. */
  osId: string;
  permissions: PermissionBits;
  areas: GroupArea[];
}

/** A domain (WinCC OA "area"); `permissions` are its default bits. */
export interface OaArea {
  id: number;
  name: string;
  fullName: string;
  comment: string;
  permissions: PermissionBits;
}

export interface UsersState {
  users: OaUser[];
  groups: OaGroup[];
  areas: OaArea[];
  permissionNames: string[];
  /** `_WinUserAdmin.External`: "Standard" (WinCC OA), "Windows" (Active Directory) or a user-defined method. */
  authName: string;
  auths: string[];
}

export interface Health {
  ok: boolean;
  serviceAvailable: boolean;
  error?: string;
  userName?: string;
  userId?: number;
  level?: number;
  canManage?: boolean;
  version?: string;
  auditDp?: string;
  auditDpExists?: boolean;
}

export interface AdEntry {
  name: string;
  osId: string;
  comment: string;
  imported: boolean;
  local?: boolean;
}

export interface ImportSettings {
  /** Cyclic import of the new AD users on; off = manual import only. */
  enabled: boolean;
  intervalMin: number;
  /** WinCC OA groups the import is restricted to; empty = every AD-linked group. */
  groups: string[];
}

export interface ImportReport {
  trigger: 'auto' | 'manual';
  by: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  created: string[];
  skippedExisting: number;
  skippedNoGroup: number;
  errors: string[];
  message: string;
}

export interface ImportStatus {
  running: boolean;
  lastRun: ImportReport | null;
  nextRunAt: string | null;
}

export interface ConfigEntry {
  section: string;
  key: string;
  value: string | null;
  default: string;
}

export interface UserSetting {
  name: string;
  fullName: string;
  format: string;
  /** Sensitive (badge number, secret): contents are never sent. */
  masked: boolean;
  base: string[] | null;
  groups: { id: number; content: string[] | null }[];
  users: { id: number; content: string[] | null }[];
}

export interface ManualImportResult {
  ok: boolean;
  created: string[];
  noGroup: string[];
  errors: string[];
}

/** One write of the user administration, as `/api/users<path>` with `body`. */
export interface WriteOp {
  path: string;
  body: Record<string, unknown>;
}

/** Detail of `wui:write`: the writes to run in order (the page runs them, then reloads). */
export interface WriteIntent {
  ops: WriteOp[];
}
