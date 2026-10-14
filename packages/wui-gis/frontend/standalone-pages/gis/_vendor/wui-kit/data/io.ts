// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared import/export primitives used by the standalone pages' own `io.ts`
 * modules. Only the page-agnostic helpers live here — each page keeps its own
 * domain-specific `exportJson` / `parse*` wrappers that call these.
 */

/** Standard indent for human-readable JSON exports. */
export const JSON_INDENT = 2;
/** UTF-8 BOM so Excel renders CSV accents correctly. */
export const CSV_BOM = '﻿';
const ISO_DATE_LEN = 10;

/** A short `YYYY-MM-DD` stamp for export filenames. */
export function timestampSlug(): string {
  return new Date().toISOString().slice(0, ISO_DATE_LEN);
}

/** Trigger a browser download of `text` as `filename` with the given MIME type. */
export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Escape a value for one CSV cell (quote when it contains separators/quotes). */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
