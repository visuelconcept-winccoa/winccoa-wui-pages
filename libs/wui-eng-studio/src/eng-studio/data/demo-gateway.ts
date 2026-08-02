// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DemoEngGateway — in-memory {@link EngGateway} seeded with {@link demo-data}.
 * Zero WinCC OA dependency: it powers the offline demo entry, the docs and the
 * Playwright screenshots. State lives in memory for the session (check-in
 * mutates the "live" snapshot so a second diff shows fewer items).
 */

import {
  DEFAULT_ROLE_RULES,
  applyPlan,
  baselineOf,
  classifyEntries,
  diffWorkspace,
  makeDpeName,
  withRoles,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type Device,
  type DpeConfigs,
  type EngPlan,
  type EngPort,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept/wui-eng-core';
import type { EngGateway, EngRole, LiveScope, TestReadResult } from './gateway.js';
import { DEMO_DEVICES, DEMO_LIVE_VALUES, demoBooks, demoLiveSnapshot } from './demo-data.js';

/**
 * Qualify a book with the default rule set, honouring the operator's manual
 * overrides. The real backend does the same on ingestion/refresh — the roles are
 * stored WITH the book so a mutualised catalog is qualified once.
 */
function qualify(book: AddressBook, manual: Record<string, SignalRole>): AddressBook {
  const assignments = classifyEntries(book.entries, DEFAULT_ROLE_RULES, manual);
  return { ...book, entries: withRoles(book.entries, assignments) };
}

/** In-memory port so the demo check-in mutates a fake live project. */
function demoPort(live: LiveSnapshot): EngPort {
  const types = new Map(live.types.map((t) => [t.typeName, t]));
  const dps = new Map(live.dps.map((d) => [d.dpName, d]));
  return {
    typeExists: async (name) => types.has(name),
    dpTypeCreate: async (structure) => void types.set(structure.name, { typeName: structure.name, structure }),
    dpTypeChange: async (structure) => void types.set(structure.name, { typeName: structure.name, structure }),
    dpTypeDelete: async (name) => void types.delete(name),
    dpExists: async (name) => dps.has(name),
    dpCreate: async (name, type) => void dps.set(name, { dpName: name, dpType: type }),
    dpDelete: async (name) => void dps.delete(name),
    dpSetWait: async () => undefined,
    resolveAddressContext: async () => ({ driverNumber: 3, pollGroupDp: '_EngStudio_Poll' }),
    // expose the mutated collections back to the gateway
    ...({ _types: types, _dps: dps } as unknown as Record<string, never>)
  };
}

export class DemoEngGateway implements EngGateway {
  readonly isDemo = true;

  private books = new Map<string, AddressBook>(demoBooks().map((b) => [b.id, qualify(b, {})]));
  /** Operator role overrides per book (path → role), kept across refreshes. */
  private manualRoles = new Map<string, Record<string, SignalRole>>();
  private live: LiveSnapshot = demoLiveSnapshot();
  private workspace: Workspace = this.seedWorkspace();

  async roles(): Promise<Set<EngRole>> {
    return new Set<EngRole>(['view', 'edit-model', 'manage-devices', 'checkin']);
  }

  async listDevices(): Promise<Device[]> {
    return DEMO_DEVICES;
  }

  async listBooks(): Promise<AddressBook[]> {
    return [...this.books.values()];
  }

  async getBook(bookId: string): Promise<AddressBook | null> {
    return this.books.get(bookId) ?? null;
  }

  async refreshBook(bookId: string): Promise<AddressBook> {
    const fresh = demoBooks().find((b) => b.id === bookId);
    // A refresh re-runs the rules but KEEPS the operator's manual overrides.
    if (fresh) this.books.set(bookId, qualify(fresh, this.manualRoles.get(bookId) ?? {}));
    return this.books.get(bookId) as AddressBook;
  }

  async saveBookRoles(bookId: string, roles: Record<string, SignalRole>): Promise<void> {
    this.manualRoles.set(bookId, { ...(this.manualRoles.get(bookId) ?? {}), ...roles });
    const book = this.books.get(bookId);
    if (book) this.books.set(bookId, qualify(book, this.manualRoles.get(bookId) ?? {}));
  }

  async getWorkspace(): Promise<Workspace> {
    return structuredClone(this.workspace);
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.workspace = structuredClone(workspace);
  }

  /**
   * The demo holds the whole fake project in memory, but it still HONOURS the
   * scope — so the offline demo and the screenshots exercise the same restriction
   * the backend applies, and an under-scoped read shows up here rather than only
   * on a live project.
   */
  async liveSnapshot(scope: LiveScope = {}): Promise<LiveSnapshot> {
    const live = structuredClone(this.live);
    const types = scope.types === undefined || scope.types.length === 0 ? null : new Set(scope.types);
    const dpes = scope.dpes === undefined ? [] : scope.dpes;
    return {
      types: types === null ? live.types : live.types.filter((t) => types.has(t.typeName)),
      dps: types === null ? live.dps : live.dps.filter((d) => types.has(d.dpType)),
      configs: Object.fromEntries(dpes.filter((dpe) => dpe in live.configs).map((dpe) => [dpe, live.configs[dpe]]))
    };
  }

  async checkin(plan: EngPlan, dryRun: boolean): Promise<ApplyReport> {
    const port = demoPort(this.live);
    const previousConfigs = Object.fromEntries(Object.entries(this.live.configs));
    const report = await applyPlan(plan, port, { dryRun, previousConfigs });
    if (!dryRun && report.ok) {
      // Fold the workspace into the fake live project so a re-diff shrinks.
      this.live = {
        types: [...(port as unknown as { _types: Map<string, LiveSnapshot['types'][number]> })._types.values()],
        dps: [...(port as unknown as { _dps: Map<string, LiveSnapshot['dps'][number]> })._dps.values()],
        configs: { ...this.live.configs, ...this.workspace.configs }
      };
      this.workspace = { ...this.workspace, baseline: baselineOf(this.live) };
    }
    return report;
  }

  async testRead(dpes: string[]): Promise<TestReadResult[]> {
    return dpes.map((dpe) => {
      const has = dpe in DEMO_LIVE_VALUES;
      return { dpe, value: has ? DEMO_LIVE_VALUES[dpe] : null, ok: has, error: has ? undefined : 'not yet created' };
    });
  }

  /** Plan for the current demo workspace (used by the UI + screenshots). */
  async plan(): Promise<EngPlan> {
    return diffWorkspace(this.workspace, this.live);
  }

  // --- seed -------------------------------------------------------------------

  /**
   * A workspace checked out from the live project, then enriched: the existing
   * `Equip_Four` gains `Mesures.Hygrometrie`, a second oven `Z01_FOUR002` is
   * added, and addresses/alarms/ranges are configured on both — so the diff
   * shows one update, creates and config writes.
   */
  private seedWorkspace(): Workspace {
    const live = demoLiveSnapshot();
    const baseline = baselineOf(live);
    const enrichedType = {
      typeName: 'Equip_Four',
      structure: {
        name: 'Equip_Four',
        type: 'Struct',
        children: [
          { name: 'Etat', type: 'Struct', children: [{ name: 'EnChauffe', type: 'Bool' }, { name: 'PorteOuverte', type: 'Bool' }] },
          { name: 'Mesures', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }, { name: 'Hygrometrie', type: 'Float' }] },
          { name: 'Consignes', type: 'Struct', children: [{ name: 'Temperature', type: 'Float' }, { name: 'Rampe', type: 'Float' }] }
        ]
      }
    };
    const configs: Record<string, DpeConfigs> = {};
    for (const dp of ['Z01_FOUR001', 'Z01_FOUR002']) {
      configs[makeDpeName(dp, 'Mesures.Temperature')] = {
        address: { deviceId: 's7-four1', mode: 's7plus', reference: '"DB_Four"."Mesures"."Temperature"', direction: 4, datatype: 760, active: true },
        alarm: { kind: 'analog', alarmClass: 'alert', direction: 'ASC', thresholds: [200, 250], bounds: [-273, 1000], active: true },
        archive: { group: 'EVENT', active: true },
        range: { min: 0, max: 450, inclMin: true, inclMax: true }
      };
      configs[makeDpeName(dp, 'Consignes.Temperature')] = {
        address: { deviceId: 's7-four1', mode: 's7plus', reference: '"DB_Four"."Consignes"."Temperature"', direction: 7, datatype: 760, active: true }
      };
      configs[makeDpeName(dp, 'Etat.EnChauffe')] = {
        address: { deviceId: 's7-four1', mode: 's7plus', reference: '"DB_Four"."Etat"."EnChauffe"', direction: 4, datatype: 751, active: true }
      };
    }
    return {
      name: 'Atelier_Fours',
      types: [enrichedType],
      dps: [
        { dpName: 'Z01_FOUR001', dpType: 'Equip_Four' },
        { dpName: 'Z01_FOUR002', dpType: 'Equip_Four' }
      ],
      configs,
      baseline,
      checkedOutAt: '2026-08-02T08:30:00.000Z',
      checkedOutBy: 'demo'
    };
  }
}
