// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Address-book helpers: refresh diff (what changed between two generations of
 * a device's book) and simple lookups. The refresh diff powers the "re-sync
 * device" flow: re-generate → diff → propose the model extension.
 */

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
 * Book warnings describing a source RE-READ (online re-browse, re-ingest).
 *
 * Lives in the core so the backend and the offline demo say exactly the same
 * thing about the same event. `removed` comes first and loudest: a signal that
 * vanished from the source may still be referenced by a workspace, and swapping
 * the catalog under a model without saying so is how a project ends up with
 * addresses pointing at nodes that no longer exist.
 */
export function refreshWarnings(delta: BookDiff): string[] {
  const warnings: string[] = [];
  if (delta.removed.length > 0) {
    const shown = delta.removed.slice(0, 8).map((e) => e.path);
    warnings.push(
      `⚠️ ${delta.removed.length} signal(aux) DISPARU(S) de la source depuis le dernier parcours (${shown.join(', ')}${delta.removed.length > shown.length ? '…' : ''}) — vérifier les modèles qui les référencent AVANT tout check-in.`
    );
  }
  if (delta.changed.length > 0) {
    warnings.push(
      `${delta.changed.length} signal(aux) MODIFIÉ(S) (type, accès ou adresse) — les configs générées à partir d’eux sont à régénérer.`
    );
  }
  if (delta.added.length > 0) {
    warnings.push(`${delta.added.length} nouveau(x) signal(aux) détecté(s) dans la source.`);
  }
  return warnings;
}

/** Case-insensitive substring filter over entry paths and comments. */
export function filterEntries(book: AddressBook, needle: string): BookEntry[] {
  const n = needle.trim().toLowerCase();
  if (n === '') return book.entries;
  return book.entries.filter(
    (e) => e.path.toLowerCase().includes(n) || (e.comment ?? '').toLowerCase().includes(n)
  );
}
