// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Naming conventions — datapoint names are GENERATED, not typed.
 *
 * Implements the Visuel Concept referential (patterns-wincc-oa):
 *   format `{Zone}_{Equipement}_{Signal}` (e.g. `Z01_PMP001_Run`),
 *   underscore-only separators, ≤ 40 chars recommended, no specials.
 */

/** Max recommended datapoint-name length (referential rule). */
export const MAX_NAME_LENGTH = 40;

/**
 * Sanitize one identifier segment: keep `[A-Za-z0-9_]`, map accented latin
 * letters to their base letter, collapse anything else to `_`, trim leading
 * digits/underscores so the segment is a valid WinCC OA identifier part.
 */
export function sanitizeSegment(raw: string): string {
  const deaccented = raw.normalize('NFD').replaceAll(/[̀-ͯ]/g, '');
  const mapped = deaccented.replaceAll(/[^A-Za-z0-9_]+/g, '_');
  return mapped.replaceAll(/^[_0-9]+|_+$/g, '').replaceAll(/_{2,}/g, '_');
}

/** Build a `{Zone}_{Equipement}` datapoint name (both segments sanitized). */
export function dpName(zone: string, equipment: string): string {
  const parts = [zone, equipment].map((p) => sanitizeSegment(p)).filter((p) => p !== '');
  return parts.join('_').slice(0, MAX_NAME_LENGTH);
}

/** Build a full `{Zone}_{Equipement}_{Signal}` name. */
export function signalName(zone: string, equipment: string, signal: string): string {
  const parts = [zone, equipment, signal].map((p) => sanitizeSegment(p)).filter((p) => p !== '');
  return parts.join('_').slice(0, MAX_NAME_LENGTH);
}

/** Numbered series: `dpSeries('Z01', 'FOUR', 3, 2)` → Z01_FOUR01..Z01_FOUR03. */
export function dpSeries(zone: string, equipmentBase: string, count: number, pad = 3): string[] {
  const base = sanitizeSegment(equipmentBase);
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(dpName(zone, `${base}${String(i).padStart(pad, '0')}`));
  }
  return out;
}

/** Make `proposed` unique against `used` by appending `_2`, `_3`, … */
export function uniqueName(proposed: string, used: Set<string>): string {
  let name = proposed;
  let n = 2;
  while (used.has(name)) {
    name = `${proposed}_${n}`;
    n += 1;
  }
  used.add(name);
  return name;
}
