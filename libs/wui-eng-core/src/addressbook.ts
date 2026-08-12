// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Address-book helpers: refresh diff (what changed between two generations of
 * a device's book) and simple lookups. The refresh diff powers the "re-sync
 * device" flow: re-generate → diff → propose the model extension.
 */

import { sanitizeSegment } from './naming.js';
import { WARNING_CODES, warn, type EngWarning } from './warnings.js';
import type { AddressBook, BookEntry, TagAccess } from './model.js';

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

/**
 * Apply the operator's MANUAL access overrides to a book (entry path → access).
 *
 * Access is engineering knowledge the source may not carry: an online browse whose
 * driver does not expose `AccessLevel` catalogues everything read-only
 * (`accessSource: 'assumed'`), and a config generator that trusts that would refuse
 * to write any command. An override is marked `manual` so it counts as EVIDENCE —
 * see `roles/profiles.ts`. Stored apart from the book (like the role overrides), so
 * a refresh keeps it.
 */
export function withAccess(entries: BookEntry[], overrides: Record<string, TagAccess>): BookEntry[] {
  if (Object.keys(overrides).length === 0) return entries;
  return entries.map((entry) => {
    const access = overrides[entry.path];
    return access === undefined ? entry : { ...entry, access, accessSource: 'manual' as const };
  });
}

/**
 * Drop the entries the operator has EXCLUDED by hand (a set of entry paths).
 *
 * Why an override rather than a destructive edit of the book: a catalog is a
 * *reading* of a source, and the source is re-read (a re-browse, a re-ingest). If
 * removing a signal rewrote the book, the next refresh would bring it straight
 * back — the operator's judgement lost to a mechanical re-read. Stored apart like
 * the role and access overrides, it survives every refresh and stays reversible,
 * which matters because "this signal is noise" is a decision, not a fact about the
 * machine.
 *
 * It is applied BEFORE the role rules and the access overrides, so an excluded
 * signal costs nothing downstream: no role, no config, no address.
 */
export function withoutExcluded(entries: BookEntry[], excluded: Iterable<string>): BookEntry[] {
  const paths = new Set(excluded);
  if (paths.size === 0) return entries;
  return entries.filter((entry) => !paths.has(entry.path));
}

/**
 * Drop entries whose path a previous entry already used, keeping the FIRST.
 *
 * A duplicate path is not cosmetic: a book is keyed by path everywhere — the refresh
 * diff (`diffBooks`), the structure bindings, the generated DPE names — so two entries
 * sharing one path silently collapse into whichever the consumer happens to reach. A
 * generator should not produce them (see the NodeSet reader's `rootInstances`); this is
 * the belt to that braces, and it REPORTS rather than hides.
 */
export function dedupeEntries(entries: BookEntry[]): { entries: BookEntry[]; duplicates: string[] } {
  const seen = new Set<string>();
  const kept: BookEntry[] = [];
  const duplicates: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) duplicates.push(entry.path);
    else {
      seen.add(entry.path);
      kept.push(entry);
    }
  }
  return { entries: duplicates.length === 0 ? entries : kept, duplicates };
}

/** Warning naming the collapsed paths — a silent de-duplication would be worse. */
export function duplicateWarning(duplicates: string[]): EngWarning {
  const shown = [...new Set(duplicates)].slice(0, 5);
  return warn(
    WARNING_CODES.book.DUPLICATE_PATHS,
    '{n} duplicate signal path(s) dropped ({paths}{more}) — a book is keyed by path, so two signals sharing one would collapse into a single DPE. Report this: the generator should not produce them.',
    { n: duplicates.length, paths: shown.join(', '), more: duplicates.length > shown.length ? '…' : '' }
  );
}

/**
 * Warning stating that a catalog is showing LESS than its source.
 *
 * A book that silently hides signals is a trap: the next engineer reads a complete
 * catalog and models from it. So the count travels with the book, in the same place
 * as the generator's own warnings.
 */
export function excludedWarning(count: number, total: number): EngWarning {
  return warn(
    WARNING_CODES.book.EXCLUDED,
    '{n}/{total} signal(s) hidden by hand — they take no role, no address and no config. Restore them from the signal table.',
    { n: count, total }
  );
}

/**
 * Book warnings describing a source RE-READ (online re-browse, re-ingest).
 *
 * Lives in the core so the backend and the offline demo say exactly the same
 * thing about the same event. `removed` comes first and loudest: a signal that
 * vanished from the source may still be referenced by a workspace, and swapping
 * the catalog under a model without saying so is how a project ends up with
 * addresses pointing at nodes that no longer exist.
 */
export function refreshWarnings(delta: BookDiff): EngWarning[] {
  const warnings: EngWarning[] = [];
  if (delta.removed.length > 0) {
    const shown = delta.removed.slice(0, 8).map((e) => e.path);
    warnings.push(
      warn(
        WARNING_CODES.book.REMOVED,
        '⚠️ {n} signal(s) GONE from the source since the last walk ({paths}{more}) — check the models that reference them BEFORE any check-in.',
        { n: delta.removed.length, paths: shown.join(', '), more: delta.removed.length > shown.length ? '…' : '' }
      )
    );
  }
  if (delta.changed.length > 0) {
    warnings.push(
      warn(WARNING_CODES.book.CHANGED, '{n} signal(s) CHANGED (type, access or address) — the configs generated from them must be regenerated.', {
        n: delta.changed.length
      })
    );
  }
  if (delta.added.length > 0) {
    warnings.push(warn(WARNING_CODES.book.ADDED, '{n} new signal(s) found in the source.', { n: delta.added.length }));
  }
  return warnings;
}

/**
 * Slug used as an address-book id: lower-case, separator-normalised, ASCII.
 *
 * Derived ONCE at creation and never re-derived from the name afterwards —
 * `Device.bookIds` references a catalog by id, so renaming a catalog must not
 * orphan the equipments it serves. Same shape as a device id (they share a
 * namespace in the operator's head and in the store's file names) but its own
 * fallback: an unnameable catalog is a `book`, not a `device`.
 */
export function bookIdFrom(name: string): string {
  const slug = sanitizeSegment(name)
    .toLowerCase()
    .replaceAll(/_+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug === '' ? 'book' : slug;
}

/** `bookIdFrom` + a numeric suffix while the id is taken. */
export function uniqueBookId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = bookIdFrom(name);
  if (!used.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Case-insensitive substring filter over entry paths and comments. */
export function filterEntries(book: AddressBook, needle: string): BookEntry[] {
  const n = needle.trim().toLowerCase();
  if (n === '') return book.entries;
  return book.entries.filter(
    (e) => e.path.toLowerCase().includes(n) || (e.comment ?? '').toLowerCase().includes(n)
  );
}
