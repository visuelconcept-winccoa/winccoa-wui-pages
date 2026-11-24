// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A data source — PROOF OF CONCEPT. What a page reads tags through, without
 * knowing where they come from: WinCC OA datapoint elements (oa-source.ts), or
 * the tags a host serves over a socket (socket-source.ts: an Industrial Edge app
 * bridging the IE Databus). The HOST picks the source (data-source.ts), never
 * the page: the same page runs on WinCC OA, on an Edge device and on the mock.
 *
 * A tag is a name: `System1:Pump.speed` on WinCC OA, `<connection>.<datapoint>`
 * on the Databus (`PLC_1.Datapoint_Int`). A pattern is a glob: `*` any run of
 * characters, `?` one.
 */
import type { Observable } from 'rxjs';

/** One tag's state: its value, and what the source knows of it. */
export interface DataSample {
  value: unknown;
  /** When the source took the value (ISO 8601) — absent when it does not say. */
  ts?: string;
  /** `good`, `uncertain` or `bad` — absent when the source does not say. */
  quality?: 'good' | 'uncertain' | 'bad';
}

export interface DataSource {
  /** What it is: `oa`, `socket`… — for a page that shows where its data comes from. */
  readonly kind: string;
  /** The tags matching a glob, once (the Observable completes). */
  names(pattern: string): Observable<string[]>;
  /** Their samples, in the order of `tags`, at once and at every change — until unsubscribed. */
  watch(tags: string[]): Observable<DataSample[]>;
}

/** Does `name` match the glob `pattern` (`*` any run, `?` one character)? */
export function matchesGlob(pattern: string, name: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${source}$`).test(name);
}
