// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Address-book helpers: refresh diff (what changed between two generations of
 * a device's book) and simple lookups. The refresh diff powers the "re-sync
 * device" flow: re-generate → diff → propose the model extension.
 */

import type { AddressBook, BookEntry } from './model.js';

export interface BookDiff {
  added: BookEntry[];
  removed: BookEntry[];
  /** Same path, but datatype/access/addresses changed. */
  changed: { before: BookEntry; after: BookEntry }[];
}

/** Diff two generations of a device's address book (keyed by entry path). */
export function diffBooks(before: AddressBook, after: AddressBook): BookDiff {
  const beforeByPath = new Map(before.entries.map((e) => [e.path, e]));
  const afterByPath = new Map(after.entries.map((e) => [e.path, e]));
  const added: BookEntry[] = [];
  const removed: BookEntry[] = [];
  const changed: { before: BookEntry; after: BookEntry }[] = [];
  for (const [path, entry] of afterByPath) {
    const prev = beforeByPath.get(path);
    if (!prev) {
      added.push(entry);
      continue;
    }
    if (
      prev.sourceType !== entry.sourceType ||
      prev.leafType !== entry.leafType ||
      prev.access !== entry.access ||
      JSON.stringify(prev.addresses) !== JSON.stringify(entry.addresses)
    ) {
      changed.push({ before: prev, after: entry });
    }
  }
  for (const [path, entry] of beforeByPath) {
    if (!afterByPath.has(path)) removed.push(entry);
  }
  return { added, removed, changed };
}

/** Case-insensitive substring filter over entry paths and comments. */
export function filterEntries(book: AddressBook, needle: string): BookEntry[] {
  const n = needle.trim().toLowerCase();
  if (n === '') return book.entries;
  return book.entries.filter(
    (e) => e.path.toLowerCase().includes(n) || (e.comment ?? '').toLowerCase().includes(n)
  );
}
