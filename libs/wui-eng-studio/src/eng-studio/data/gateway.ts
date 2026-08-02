// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * EngGateway — the single seam between the studio UI and its data source.
 *
 * The UI depends ONLY on this interface. Two implementations exist:
 *  - {@link import('./demo-gateway.js').DemoEngGateway} — in-memory, seeded
 *    with rich sample data; drives the docs, screenshots and offline demo
 *    WITHOUT any WinCC OA runtime;
 *  - {@link import('./http-gateway.js').HttpEngGateway} — talks to the
 *    `/api/eng/*` backend on a live deployment.
 *
 * Keeping this contract narrow is what lets the whole page render, be
 * screenshotted and (mostly) tested with no runtime.
 */

import type {
  AddressBook,
  ApplyReport,
  Device,
  EngPlan,
  LiveSnapshot,
  SignalRole,
  Workspace
} from '@visuelconcept/wui-eng-core';

/** A named role the studio gates its affordances with. */
export type EngRole = 'view' | 'edit-model' | 'manage-devices' | 'checkin';

/** A live value read for one DPE while configuring (pre-check-in test-read). */
export interface TestReadResult {
  dpe: string;
  value: unknown;
  ok: boolean;
  error?: string;
}

/**
 * Scope of a live read — what the diff needs, and nothing more.
 *
 * Reading back the configs of a project is expensive (16 attributes per DPE), so
 * the caller declares its scope instead of asking for everything. Use the core's
 * `liveScopeOf(workspace)`: it is the union of the workspace and its check-out
 * baseline, which is what makes deletions visible (a config removed from the
 * workspace is only in the baseline). An omitted/empty `types` means "every
 * non-internal DP type"; an omitted/empty `dpes` means "no config read-back".
 */
export interface LiveScope {
  types?: string[];
  dpes?: string[];
}

export interface EngGateway {
  /** Whether this gateway is the offline demo (drives a visible banner). */
  readonly isDemo: boolean;

  /** Roles granted to the current user (open-by-default like the rest of the suite). */
  roles(): Promise<Set<EngRole>>;

  // --- devices + address books (many-to-many) ---------------------------------
  /** Equipments — each carries `bookIds` (see the N:N relation in the model). */
  listDevices(): Promise<Device[]>;
  /** Every address book (registry). A book may be referenced by several devices. */
  listBooks(): Promise<AddressBook[]>;
  /** One book by its id, or null. */
  getBook(bookId: string): Promise<AddressBook | null>;
  /**
   * (Re)generate a book from its configured source (browse / last ingested
   * SimaticML bundle). Returns the fresh book.
   */
  refreshBook(bookId: string): Promise<AddressBook>;
  /**
   * Persist the operator's MANUAL role overrides of a book (path → role).
   * Rule-derived roles are recomputed, manual ones are kept.
   */
  saveBookRoles(bookId: string, roles: Record<string, SignalRole>): Promise<void>;

  // --- workspace + check-in ---------------------------------------------------
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  /**
   * Read the live project into the same shape (check-out / diff probe).
   * `scope` restricts the read — see {@link LiveScope}. Called with no scope it
   * returns the types and datapoints only (no config read-back).
   */
  liveSnapshot(scope?: LiveScope): Promise<LiveSnapshot>;
  /** Apply a plan; `dryRun` previews without writing. */
  checkin(plan: EngPlan, dryRun: boolean): Promise<ApplyReport>;

  // --- validation -------------------------------------------------------------
  /** Read current values for a set of DPEs via the device connection. */
  testRead(dpes: string[]): Promise<TestReadResult[]>;
}
