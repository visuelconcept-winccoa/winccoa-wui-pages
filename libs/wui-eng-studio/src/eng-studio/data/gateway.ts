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

export interface EngGateway {
  /** Whether this gateway is the offline demo (drives a visible banner). */
  readonly isDemo: boolean;

  /** Roles granted to the current user (open-by-default like the rest of the suite). */
  roles(): Promise<Set<EngRole>>;

  // --- devices + address books ------------------------------------------------
  listDevices(): Promise<Device[]>;
  /** The current (persisted) address book of a device, or null if none yet. */
  getAddressBook(deviceId: string): Promise<AddressBook | null>;
  /**
   * (Re)generate the device's address book from its configured source
   * (browse / last ingested SimaticML bundle). Returns the fresh book.
   */
  refreshAddressBook(deviceId: string): Promise<AddressBook>;

  // --- workspace + check-in ---------------------------------------------------
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  /** Read the live project into the same shape (check-out / diff probe). */
  liveSnapshot(): Promise<LiveSnapshot>;
  /** Apply a plan; `dryRun` previews without writing. */
  checkin(plan: EngPlan, dryRun: boolean): Promise<ApplyReport>;

  // --- validation -------------------------------------------------------------
  /** Read current values for a set of DPEs via the device connection. */
  testRead(dpes: string[]): Promise<TestReadResult[]>;
}
