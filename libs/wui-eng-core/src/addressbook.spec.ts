// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Address-book refresh diff (the re-sync mechanic). */
import { describe, expect, it } from 'vitest';
import { diffBooks } from './addressbook.js';
import type { AddressBook, BookEntry } from './model.js';

function entry(path: string, sourceType = 'Real'): BookEntry {
  return {
    path,
    sourceType,
    leafType: sourceType === 'Bool' ? 'Bool' : 'Float',
    access: 'rw',
    addresses: { s7plus: `"${path}"` }
  };
}

function book(entries: BookEntry[]): AddressBook {
  return {
    id: 'book1',
    name: 'Book 1',
    provenance: { kind: 'simaticml', generatedAt: '2026-08-02T00:00:00.000Z' },
    entries,
    types: [],
    warnings: []
  };
}

describe('diffBooks', () => {
  it('reports added, removed and retyped entries', () => {
    const before = book([entry('DB.A'), entry('DB.B'), entry('DB.C', 'Bool')]);
    const after = book([entry('DB.A'), entry('DB.C', 'Int'), entry('DB.D')]);
    const diff = diffBooks(before, after);
    expect(diff.added.map((e) => e.path)).toEqual(['DB.D']);
    expect(diff.removed.map((e) => e.path)).toEqual(['DB.B']);
    expect(diff.changed.map((c) => c.after.path)).toEqual(['DB.C']);
  });

  it('is empty for identical generations', () => {
    const a = book([entry('DB.A')]);
    const diff = diffBooks(a, book([entry('DB.A')]));
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});
