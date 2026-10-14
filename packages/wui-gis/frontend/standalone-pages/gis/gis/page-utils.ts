// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Small page-level utilities of the GIS shell: the saved-at stamp, the id generator
 * for newly placed objects, and the chromeless-embed detection.
 *
 * Split out of `gis.ts` so the page entry stays about the page.
 */

const ID_RADIX = 36;
const PAD_LEN = 2;
/** Milliseconds in a second — the sub-millisecond part of a generated id. */
const MILLI = 1000;

function pad(value: number): string {
  return String(value).padStart(PAD_LEN, '0');
}

/**
 * Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now" — the `updatedAt` stamp.
 * Local, not UTC: it is read by whoever is standing in front of the workstation.
 */
export function nowLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Unique id with a short prefix, for an asset or area created on the map. Only has
 * to be unique within one site, and the sub-millisecond tail keeps two objects
 * placed in the same millisecond apart.
 */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(ID_RADIX)}${Math.trunc(performance.now() % MILLI)}`;
}

/**
 * Chromeless embedded mode (e.g. a Mosaic tile): the `embed=1` flag travels INSIDE
 * the hash, after the route (`…#/gis/reseau-eau?embed=1`) — the same contract as the
 * app shell's own chrome hiding. Latched once at module load (the SPA router may
 * rewrite the URL later) with a live re-check as the fallback.
 */
const EMBEDDED_AT_LOAD =
  /[?&]embed=1/.test(globalThis.location?.hash ?? '') ||
  /[?&]embed=1/.test(globalThis.location?.search ?? '');

export function isEmbedded(): boolean {
  return (
    EMBEDDED_AT_LOAD || /[?&]embed=1/.test(globalThis.location?.hash ?? '')
  );
}
