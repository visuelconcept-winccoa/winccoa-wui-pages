// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Client of the Users backend (`/api/users`, bridged over MSA vRPC to the
 * usersService manager, which writes through WinCC OA's UserManagement).
 */
import type { AdEntry, ConfigEntry, Health, ImportSettings, ImportStatus, ManualImportResult, UserSetting, UsersState } from '../types.js';

const BASE = '/api/users';

/**
 * A backend failure with its HTTP status: 403 a refused role, 409 a refusal of the
 * WinCC OA user administration (its reason in the message), 502/503 the manager
 * is not reachable (see `isBridgeError`).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isBridgeError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 502 || error.status === 503);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string; errors?: string[] }) | null;
  if (!res.ok || data === null || data.ok === false) {
    const detail = data?.errors && data.errors.length > 1 ? ` (${data.errors.join(' · ')})` : '';
    throw new ApiError(`${data?.error || `HTTP ${res.status}`}${detail}`, res.status);
  }
  return data;
}

const getJson = <T>(url: string): Promise<T> => request<T>(url);

const postJson = <T>(url: string, body: object): Promise<T> =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function health(): Promise<Health> {
  const res = await fetch(`${BASE}/health`);
  return ((await res.json().catch(() => null)) as Health | null) ?? { ok: false, serviceAvailable: false, error: `HTTP ${res.status}` };
}

export function loadState(): Promise<UsersState> {
  return getJson<UsersState>(`${BASE}/state`);
}

/** A write of the user administration: `/users/create`, `/groups/update`, `/auth/mode`… */
export function write(path: string, body: object): Promise<{ ok: boolean; id?: number }> {
  return postJson(`${BASE}${path}`, body);
}

export async function adGroups(cached = false): Promise<AdEntry[]> {
  return (await getJson<{ groups: AdEntry[] }>(`${BASE}/ad/groups${cached ? '?cached=1' : ''}`)).groups ?? [];
}

export async function adUsers(cached = false): Promise<AdEntry[]> {
  return (await getJson<{ users: AdEntry[] }>(`${BASE}/ad/users${cached ? '?cached=1' : ''}`)).users ?? [];
}

export function importAdGroups(names: string[]): Promise<{ created: string[] }> {
  return postJson(`${BASE}/ad/groups/import`, { names });
}

export function importAdUsers(names: string[]): Promise<ManualImportResult> {
  return postJson(`${BASE}/ad/users/import`, { names });
}

export function importState(): Promise<{ settings: ImportSettings; status: ImportStatus }> {
  return getJson(`${BASE}/import`);
}

export function saveImportSettings(settings: ImportSettings): Promise<{ settings: ImportSettings; status: ImportStatus }> {
  return postJson(`${BASE}/import/settings`, settings);
}

export function runImport(): Promise<{ started: boolean; status: ImportStatus }> {
  return postJson(`${BASE}/import/run`, {});
}

export function loadSettings(): Promise<{ config: ConfigEntry[]; userSettings: UserSetting[] }> {
  return getJson(`${BASE}/settings`);
}
