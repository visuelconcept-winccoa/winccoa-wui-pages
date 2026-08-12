// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Address-book refresh diff (the re-sync mechanic). */
import { describe, expect, it } from 'vitest';
import { bookIdFrom, diffBooks, excludedWarning, uniqueBookId, withAccess, withoutExcluded } from './addressbook.js';
import { formatWarning } from './warnings.js';
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


describe('bookIdFrom / uniqueBookId', () => {
  it('slugifies a catalog name to an ASCII, separator-normalised id', () => {
    expect(bookIdFrom('Catalogue_Pompe_KSB')).toBe('catalogue-pompe-ksb');
    expect(bookIdFrom('PackML v1.01 (OMAC)')).toBe('packml-v1-01-omac');
    // Accents decompose to their base letter; a letter with no decomposition
    // (Ø) is not guessed at — it collapses to a separator like any other symbol.
    expect(bookIdFrom('Débitmètre Ø200')).toBe('debitmetre-200');
  });

  it('falls back to "book" rather than to a device-shaped id', () => {
    expect(bookIdFrom('   ')).toBe('book');
    expect(bookIdFrom('123')).toBe('book');
  });

  it('suffixes only while the id is taken — equipments reference a catalog by id', () => {
    expect(uniqueBookId('PackML', [])).toBe('packml');
    expect(uniqueBookId('PackML', ['packml'])).toBe('packml-2');
    expect(uniqueBookId('PackML', ['packml', 'packml-2'])).toBe('packml-3');
    expect(uniqueBookId('PackML', ['autre'])).toBe('packml');
  });
});

describe('withoutExcluded', () => {
  const entries: BookEntry[] = [
    { path: 'A.Cmd', sourceType: 'Boolean', leafType: 'Bool', access: 'rw', addresses: {} },
    { path: 'A.Mes', sourceType: 'Double', leafType: 'Float', access: 'r', addresses: {} },
    { path: 'A.Diag', sourceType: 'String', leafType: 'String', access: 'r', addresses: {} }
  ];

  it('drops exactly the excluded paths, keeping the source order', () => {
    expect(withoutExcluded(entries, ['A.Mes']).map((e) => e.path)).toEqual(['A.Cmd', 'A.Diag']);
    expect(withoutExcluded(entries, ['A.Cmd', 'A.Diag']).map((e) => e.path)).toEqual(['A.Mes']);
  });

  it('is a no-op without exclusions and never mutates its input', () => {
    expect(withoutExcluded(entries, [])).toBe(entries);
    withoutExcluded(entries, ['A.Cmd']);
    expect(entries).toHaveLength(3);
  });

  it('ignores a path the book does not have (a stale override is not an error)', () => {
    expect(withoutExcluded(entries, ['Z.Absent']).map((e) => e.path)).toEqual(['A.Cmd', 'A.Mes', 'A.Diag']);
  });
});

describe('excludedWarning', () => {
  it('states the count AND the total — a hidden signal must never be invisible', () => {
    const warning = excludedWarning(2, 45);
    expect(warning.code).toBe('book.excluded');
    expect(formatWarning(warning)).toContain('2/45');
  });
});
