// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Address-book refresh diff (the re-sync mechanic). */
import { describe, expect, it } from 'vitest';
import { diffBooks, withAccess } from './addressbook.js';
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

describe('withAccess', () => {
  const entries: BookEntry[] = [
    { path: 'A.Cmd', sourceType: 'Boolean', leafType: 'Bool', access: 'r', accessSource: 'assumed', addresses: {} },
    { path: 'A.Mes', sourceType: 'Double', leafType: 'Float', access: 'r', accessSource: 'assumed', addresses: {} }
  ];

  it('overrides the access and marks it MANUAL (so it counts as evidence)', () => {
    const out = withAccess(entries, { 'A.Cmd': 'w' });
    expect(out[0]).toMatchObject({ access: 'w', accessSource: 'manual' });
    // Untouched entries keep their assumed access.
    expect(out[1]).toMatchObject({ access: 'r', accessSource: 'assumed' });
  });

  it('is a pure transform and a no-op without overrides', () => {
    expect(withAccess(entries, {})).toBe(entries);
    withAccess(entries, { 'A.Cmd': 'rw' });
    expect(entries[0].access).toBe('r');
  });

  it('ignores an override for a path the book does not have', () => {
    expect(withAccess(entries, { 'Z.Absent': 'rw' }).map((e) => e.access)).toEqual(['r', 'r']);
  });
});

