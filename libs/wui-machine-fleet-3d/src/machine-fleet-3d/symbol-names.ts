// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A symbol's name is unique in its atelier (#276): two symbols differing only by case, accents or
 * surrounding spaces count as the same name.
 */

/** Comparison key of a symbol name: trimmed, inner spaces collapsed, no accents, lower case. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when another symbol (id ≠ `id`) of the atelier already has this name. */
export function nameTaken(name: string, id: string, machines: ReadonlyArray<{ id: string; name: string }>): boolean {
  const key = nameKey(name);
  return key !== '' && machines.some((m) => m.id !== id && nameKey(m.name) === key);
}

/** `name` if free in the atelier, else `name (2)`, `name (3)`… — the first free one. */
export function uniqueName(name: string, machines: ReadonlyArray<{ name: string }>): string {
  const keys = new Set(machines.map((m) => nameKey(m.name)));
  if (!keys.has(nameKey(name))) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!keys.has(nameKey(candidate))) return candidate;
  }
}
