// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WinCC OA identifier helpers. DPType / DP / DPE names allow only
 * `[A-Za-z0-9_]` and must not start with a digit; OPC UA BrowseNames may carry a
 * namespace prefix (`2:Pump`) and arbitrary characters, so they are sanitised.
 */

/** Strip an OPC UA BrowseName namespace prefix (`2:Name` → `Name`). */
export function stripBrowseNs(browseName: string): string {
  const idx = browseName.indexOf(':');
  // Only strip when the prefix is a namespace index (digits), not a real colon.
  if (idx > 0 && /^\d+$/.test(browseName.slice(0, idx))) return browseName.slice(idx + 1);
  return browseName;
}

/**
 * Sanitise an arbitrary label into a WinCC OA identifier: keep `[A-Za-z0-9_]`,
 * replace every other run with a single `_`, and prefix `_` when the result
 * would start with a digit. Empty input falls back to `Item`.
 */
export function sanitizeIdentifier(raw: string): string {
  const cleaned = raw
    .replaceAll(/[^A-Za-z0-9_]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  if (cleaned === '') return 'Item';
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Proposed DPType name: `<prefix><sanitised display name>`. */
export function proposeTypeName(prefix: string, displayName: string): string {
  return `${prefix}${sanitizeIdentifier(stripBrowseNs(displayName))}`;
}

/** Proposed DP (instance) name from a source BrowseName/display name. */
export function proposeDpName(displayName: string): string {
  return sanitizeIdentifier(stripBrowseNs(displayName));
}

/**
 * Return `name` if unused, else the first `name_2`, `name_3`, … not in `used`.
 * Mutates `used` by adding the returned name.
 */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let n = 2;
  while (used.has(`${name}_${n}`)) n += 1;
  const out = `${name}_${n}`;
  used.add(out);
  return out;
}
