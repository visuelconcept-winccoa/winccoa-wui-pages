// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The client-driven walks (OPC UA and S7Plus) — shared by both gateways.
 *
 * `POST /books/browse` walks a server entirely on the backend and answers once. On a
 * real machine that is minutes with nothing on screen, no way to look at the address
 * space first, and no way to stop. So the page runs **the core's own walker** over a
 * per-level port instead: identical, unit-tested code, one round-trip per level, a
 * progress event per request, and cancellation for free (the walker unwinds when the
 * progress callback throws).
 *
 * What lives here is only the part both gateways share: walk → diff against the
 * previous generation → attach the refresh warnings. Persisting the result is the
 * gateway's own business (an HTTP PUT, or a Map in the demo).
 */

import {
  buildBookFromOpcUaBrowse,
  buildBookFromS7PlusBrowse,
  diffBooks,
  refreshWarnings,
  type AddressBook,
  type OpcUaBrowsePort,
  type S7PlusBrowsePort
} from '@visuelconcept-winccoa/wui-eng-core';
import type { BookDelta, S7PlusWalkRequest, WalkRequest } from './gateway.js';

/** A walked book plus what moved since the stored generation. */
export interface WalkOutcome {
  book: AddressBook;
  delta?: BookDelta;
}

/** Entry paths of a diff (the full entries would bloat a UI message). */
function summarise(delta: ReturnType<typeof diffBooks>): BookDelta {
  return {
    added: delta.added.map((entry) => entry.path),
    removed: delta.removed.map((entry) => entry.path),
    changed: delta.changed.map((change) => change.after.path)
  };
}

/**
 * Walk `request.connection` into a book, reporting progress.
 *
 * `previous` is the stored generation, or null for a first walk. When there is one,
 * the delta is computed AND the removals are turned into book warnings — a signal
 * that vanished may still be referenced by a model, which is the whole reason a
 * re-browse is worth doing.
 */
export async function walkIntoBook(
  port: OpcUaBrowsePort,
  previous: AddressBook | null,
  request: WalkRequest
): Promise<WalkOutcome> {
  const fresh = await buildBookFromOpcUaBrowse(port, {
    bookId: request.bookId,
    connection: request.connection,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.rootNodeId === undefined ? {} : { rootNodeId: request.rootNodeId }),
    ...(request.driverNumber === undefined ? {} : { driverNumber: request.driverNumber }),
    ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
    ...(request.maxEntries === undefined ? {} : { maxEntries: request.maxEntries }),
    ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress })
  });
  // A catalog with no entries yet (declared, then walked) is not a "previous
  // generation": diffing against it would report every signal as added.
  if (previous === null || previous.entries.length === 0) return { book: fresh };
  const delta = diffBooks(previous, fresh);
  return {
    book: { ...fresh, warnings: [...refreshWarnings(delta), ...fresh.warnings] },
    delta: summarise(delta)
  };
}

/**
 * Same, for an **S7Plus** station — one function per protocol rather than a
 * parameterised one: the two walkers take different sources (a node id versus a
 * TIA `project|station`), and the only part that would be shared is the four lines
 * of diffing below, which are not worth an abstraction that hides the difference.
 *
 * The diff matters more here than anywhere else: a PLC program is edited daily, so
 * a signal that vanished from a re-browsed station is very likely still referenced
 * by a model — which is exactly what `refreshWarnings` puts in front of the
 * operator.
 */
export async function walkS7PlusIntoBook(
  port: S7PlusBrowsePort,
  previous: AddressBook | null,
  request: S7PlusWalkRequest
): Promise<WalkOutcome> {
  const fresh = await buildBookFromS7PlusBrowse(port, {
    bookId: request.bookId,
    connection: request.connection,
    station: request.station,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.root === undefined ? {} : { root: request.root }),
    ...(request.hmiVisibleOnly === undefined ? {} : { hmiVisibleOnly: request.hmiVisibleOnly }),
    ...(request.driverNumber === undefined ? {} : { driverNumber: request.driverNumber }),
    ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
    ...(request.maxEntries === undefined ? {} : { maxEntries: request.maxEntries }),
    ...(request.maxRequests === undefined ? {} : { maxRequests: request.maxRequests }),
    ...(request.maxArrayElements === undefined ? {} : { maxArrayElements: request.maxArrayElements }),
    ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress })
  });
  if (previous === null || previous.entries.length === 0) return { book: fresh };
  const delta = diffBooks(previous, fresh);
  return {
    book: { ...fresh, warnings: [...refreshWarnings(delta), ...fresh.warnings] },
    delta: summarise(delta)
  };
}
