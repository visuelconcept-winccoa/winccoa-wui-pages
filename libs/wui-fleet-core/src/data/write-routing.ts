// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the FleetStore's writes go. By default to PARA (`/api/para/…`). The pages that declare
 * wui-fleet-closures import `guarded-writes.js`, which sets its backend as the base: each PARA write then
 * goes through it when it answers, checked on the server against the role it needs. A page embedding a
 * fleet view without that module (the workcenters' "Vue machine fleet") leaves it unset. Pure, tested by
 * guarded-writes.spec.ts.
 */

const PARA_API = '/api/para';

let base: string | null = null;

/** Send the store's PARA writes through `next` when it answers (`null`: PARA's own). */
export function routeWritesThrough(next: string | null): void {
  base = next;
}

/** The base set by the page, or null. */
export function guardedWritesBase(): string | null {
  return base;
}

/** A write's URL: a PARA one moved under `guarded` when it answers, else unchanged. */
export function routedWriteUrl(url: string, guarded: string | null, answers: boolean): string {
  return guarded && answers && url.startsWith(PARA_API) ? guarded + url.slice(PARA_API.length) : url;
}
