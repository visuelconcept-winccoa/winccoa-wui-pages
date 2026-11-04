// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Pure helpers of the Users page (unit-tested in model.spec.ts). */
import type { OaGroup, OaUser, PermissionBits } from './types.js';

/** `_WinUserAdmin.External` of the two built-in methods (OaAuthMethodStandard / OaAuthMethodAD). */
export const AUTH_STANDARD = 'Standard';
export const AUTH_AD = 'Windows';

export function isAdMode(authName: string): boolean {
  return authName === AUTH_AD;
}

export function emptyBits(): PermissionBits {
  return Array.from({ length: 32 }, () => false);
}

/** 32 bits, whatever came (missing bits off). */
export function normalizeBits(bits: readonly boolean[] | undefined): PermissionBits {
  return Array.from({ length: 32 }, (_, i) => bits?.[i] === true);
}

/** The label of permission level `level` (1..32): its name when it has one. */
export function permissionLabel(level: number, names: readonly string[]): string {
  const name = names[level - 1]?.trim();
  return name ? `${level} — ${name}` : String(level);
}

/** The levels granted, as "1, 2, 5" ('—' when none). */
export function bitsSummary(bits: readonly boolean[]): string {
  const levels = bits.map((on, i) => (on ? i + 1 : 0)).filter((level) => level > 0);
  return levels.length > 0 ? levels.join(', ') : '—';
}

export function sameBits(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Case-insensitive match of `query` in any of the given texts. */
export function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || texts.some((t) => (t ?? '').toLowerCase().includes(q));
}

export function groupNames(user: OaUser, groups: readonly OaGroup[]): string[] {
  return user.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? `#${id}`);
}

export function memberIds(group: OaGroup, users: readonly OaUser[]): number[] {
  return users.filter((u) => u.groupIds.includes(group.id)).map((u) => u.id);
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Toggle `id` in a list of ids (a new list). */
export function toggleId(ids: readonly number[], id: number, on: boolean): number[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/** WinCC OA names: 1–64 characters, no control characters, no blanks around. */
export function isValidName(name: string): boolean {
  return name.length > 0 && name.length <= 64 && name === name.trim() && !/[\u0000-\u001f\u007f]/.test(name);
}

/** Only the fields that changed (for an update request). */
export function changedFields<T extends object>(before: T, after: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) out[key] = after[key];
  }
  return out;
}
