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
  asEngWarnings,
  baselineOf,
  blockingProblems,
  formatWarning,
  normalizeDevice,
  validateDevice,
  buildBookFromOpcUaBrowse,
  classifyEntries,
  diffBooks,
  diffWorkspace,
  refreshWarnings,
  makeDpeName,
  withAccess,
  withRoles,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type Device,
  type DeviceDraft,
  type DpeConfigs,
  type EngPlan,
  type EngPort,
  type LiveSnapshot,
  type TagAccess,
  type Workspace
} from '@visuelconcept/wui-eng-core';
import type {
  BookRefresh,
  BrowseRequest,
  EngConnection,
  EngGateway,
  EngRole,
  LiveScope,
  TestReadResult
} from './gateway.js';
import { DEMO_CONNECTIONS, DemoOpcUaBrowsePort } from './demo-opcua-server.js';
import { DEMO_DEVICES, DEMO_LIVE_VALUES, demoBooks, demoLiveSnapshot } from './demo-data.js';

/**
 * Qualify a book with the default rule set, honouring the operator's manual
 * overrides. The real backend does the same on ingestion/refresh — the roles are
 * stored WITH the book so a mutualised catalog is qualified once.
 */
function qualify(
  book: AddressBook,
  manual: Record<string, SignalRole>,
  access: Record<string, TagAccess> = {}
): AddressBook {
  // Access overrides FIRST: structural role rules match on the access mode.
  const entries = withAccess(book.entries, access);
  const assignments = classifyEntries(entries, DEFAULT_ROLE_RULES, manual);
  // Same tolerance as the backend: a fixture (or a stored book) may still carry
  // plain-string warnings.
  return { ...book, entries: withRoles(entries, assignments), warnings: asEngWarnings(book.warnings) };
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
  /** Operator ACCESS overrides per book (path → r/w/rw), kept across refreshes. */
  private manualAccess = new Map<string, Record<string, TagAccess>>();
  /** The fake OPC UA server the demo browses (drifts between generations). */
  private readonly browsePort = new DemoOpcUaBrowsePort();
  /** One-shot seeding of the walker-produced online book. */
  private browseSeed: Promise<void> | null = null;
  private live: LiveSnapshot = demoLiveSnapshot();
  private workspace: Workspace = this.seedWorkspace();

  async roles(): Promise<Set<EngRole>> {
    return new Set<EngRole>(['view', 'edit-model', 'manage-devices', 'checkin']);
  }

  /** Mutable in the demo, so the form's create/edit/delete actually persist. */
  private devices: Device[] = DEMO_DEVICES.map((device) => ({ ...device }));

  async listDevices(): Promise<Device[]> {
    return this.devices.map((device) => ({ ...device }));
  }

  /**
   * Same contract as the backend, deliberately including its REFUSALS: validate
   * with the core, then normalise; an empty `id` creates (the id is derived here,
   * as the server does), a non-empty unknown one is an error rather than a silent
   * creation. A demo that is laxer than the real gateway teaches the wrong thing.
   */
  async saveDevice(id: string, draft: DeviceDraft): Promise<Device[]> {
    const index = id === '' ? -1 : this.devices.findIndex((device) => device.id === id);
    if (id !== '' && index === -1) throw new Error(`unknown device '${id}'`);
    const others = this.devices.filter((device) => device.id !== id);
    const problems = blockingProblems(validateDevice({ ...draft, id }, others));
    if (problems.length > 0) throw new Error(problems.map((problem) => formatWarning(problem)).join(' '));
    const device = normalizeDevice({ ...draft, id }, others);
    if (index === -1) this.devices = [...this.devices, device];
    else this.devices = this.devices.map((existing, at) => (at === index ? { ...existing, ...device } : existing));
    return this.listDevices();
  }

  async deleteDevice(id: string): Promise<Device[]> {
    // Books are KEPT: a catalog may be shared with another equipment.
    if (!this.devices.some((device) => device.id === id)) throw new Error(`unknown device '${id}'`);
    this.devices = this.devices.filter((device) => device.id !== id);
    return this.listDevices();
  }

  async listBooks(): Promise<AddressBook[]> {
    await this.ensureBrowsedBook();
    return [...this.books.values()];
  }

  async getBook(bookId: string): Promise<AddressBook | null> {
    await this.ensureBrowsedBook();
    return this.books.get(bookId) ?? null;
  }

  /**
   * Produce the demo's ONLINE book with the real core walker (generation 1 of the
   * fake server), once. Everything else in `demoBooks()` is a literal fixture; this
   * one is a genuine walk, so the browse path — paths, datatype mapping, warnings,
   * and later its refresh delta — is what the docs and screenshots actually show.
   */
  private async ensureBrowsedBook(): Promise<void> {
    this.browseSeed ??= this.seedBrowsedBook();
    await this.browseSeed;
  }

  private async seedBrowsedBook(): Promise<void> {
    const book = await buildBookFromOpcUaBrowse(this.browsePort, {
      bookId: 'book-opcua-remplisseuse',
      name: 'OPC UA Remplisseuse (parcours en ligne)',
      connection: 'Remplisseuse',
      generatedAt: '2026-08-02T09:15:00.000Z'
    });
    this.books.set(book.id, qualify(book, {}));
  }

  /**
   * Same contract as the backend: an `opcua-browse` book with replayable
   * parameters is RE-BROWSED (against the fake server, which drifts between
   * generations); any other book only has its rules re-run.
   */
  async refreshBook(bookId: string): Promise<BookRefresh> {
    await this.ensureBrowsedBook();
    const previous = this.books.get(bookId);
    const source = previous?.provenance.browse;
    if (previous && previous.provenance.kind === 'opcua-browse' && source) {
      this.browsePort.advance(); // the machine's program moved on since last time
      return this.runBrowse({ ...source, bookId, name: previous.name });
    }
    const fresh = demoBooks().find((b) => b.id === bookId);
    // A rules-only refresh KEEPS the operator's manual overrides.
    if (fresh) this.books.set(bookId, qualify(fresh, this.manualRoles.get(bookId) ?? {}, this.manualAccess.get(bookId) ?? {}));
    return {
      book: this.books.get(bookId) as AddressBook,
      rebrowsed: false,
      note: 'Source hors ligne : seules les règles de qualification ont été rejouées.'
    };
  }

  async listConnections(): Promise<EngConnection[]> {
    return DEMO_CONNECTIONS;
  }

  async browseBook(request: BrowseRequest): Promise<BookRefresh> {
    await this.ensureBrowsedBook();
    return this.runBrowse(request);
  }

  /** The shared browse path: walk, diff against the stored book, store, report. */
  private async runBrowse(request: BrowseRequest): Promise<BookRefresh> {
    const previous = this.books.get(request.bookId) ?? null;
    const fresh = await buildBookFromOpcUaBrowse(this.browsePort, {
      bookId: request.bookId,
      connection: request.connection,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.rootNodeId === undefined ? {} : { rootNodeId: request.rootNodeId }),
      ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
      ...(request.maxEntries === undefined ? {} : { maxEntries: request.maxEntries })
    });
    const delta = previous === null ? null : diffBooks(previous, fresh);
    const warned = delta === null ? fresh : { ...fresh, warnings: [...refreshWarnings(delta), ...fresh.warnings] };
    const stored = qualify(warned, this.manualRoles.get(request.bookId) ?? {}, this.manualAccess.get(request.bookId) ?? {});
    this.books.set(request.bookId, stored);
    return {
      book: stored,
      rebrowsed: true,
      ...(delta === null
        ? {}
        : {
            delta: {
              added: delta.added.map((e) => e.path),
              removed: delta.removed.map((e) => e.path),
              changed: delta.changed.map((c) => c.after.path)
            }
          })
    };
  }

  async saveBookRoles(bookId: string, roles: Record<string, SignalRole>): Promise<void> {
    this.manualRoles.set(bookId, { ...(this.manualRoles.get(bookId) ?? {}), ...roles });
    this.requalify(bookId);
  }

  async saveBookAccess(bookId: string, access: Record<string, TagAccess | ''>): Promise<void> {
    const merged = { ...(this.manualAccess.get(bookId) ?? {}) };
    for (const [path, mode] of Object.entries(access)) {
      if (mode === '') delete merged[path];
      else merged[path] = mode;
    }
    this.manualAccess.set(bookId, merged);
    this.requalify(bookId);
  }

  private requalify(bookId: string): void {
    const book = this.books.get(bookId);
    if (!book) return;
    this.books.set(bookId, qualify(book, this.manualRoles.get(bookId) ?? {}, this.manualAccess.get(bookId) ?? {}));
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
