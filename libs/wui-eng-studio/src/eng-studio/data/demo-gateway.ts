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
  opcuaSecurityWrite,
  validateDevice,
  buildBookFromIngest,
  CONN_STATE,
  declaredAddressOf,
  deviceStateOf,
  deviceStateFromConnState,
  buildBookFromOpcUaBrowse,
  classifyEntries,
  crossCheckBookAgainstInventory,
  diffBooks,
  diffWorkspace,
  excludedWarning,
  refreshWarnings,
  makeDpeName,
  withAccess,
  withRoles,
  withoutExcluded,
  templateIdFrom,
  OPCUA_OBJECTS_FOLDER,
  POLL_GROUPS,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type Device,
  type DeviceDraft,
  type DeviceStateUpdate,
  type DpeConfigs,
  type EngPlan,
  type EngPort,
  type EngType,
  type LiveSnapshot,
  type ModelTemplate,
  type OpcUaBrowseNode,
  type S7Inventory,
  type S7PlusBrowseNode,
  type TagAccess,
  type Workspace
} from '@visuelconcept-winccoa/wui-eng-core';
import { S7_INVENTORY } from '@visuelconcept-winccoa/wui-eng-core/samples/s7-fixtures.js';
import type {
  BookDeletion,
  BookRefresh,
  BrowseRequest,
  ConnectionProvision,
  ConnectionSecurity,
  DeviceSaveResult,
  EngConfigOptions,
  EngConnection,
  EngDriver,
  EngGateway,
  EngRole,
  EngS7PlusConnection,
  EngS7PlusProject,
  EngS7PlusStation,
  IngestRequest,
  S7InventoryResult,
  LiveScope,
  S7PlusManagerHealth,
  S7PlusWalkRequest,
  TestReadResult,
  WalkRequest
} from './gateway.js';
import { walkIntoBook as runWalk, walkS7PlusIntoBook as runS7PlusWalk } from './walk.js';
import { DEMO_CONNECTIONS, DemoOpcUaBrowsePort } from './demo-opcua-server.js';
import { DEMO_S7PLUS_CONNECTIONS, DemoS7PlusBrowsePort } from './demo-s7plus-station.js';
import { DEMO_ALARM_CLASSES, DEMO_ARCHIVE_GROUPS, DEMO_SUBSCRIPTIONS, DEMO_CONN_STATE, DEMO_DEVICES, DEMO_DRIVERS, DEMO_LIVE_VALUES, DEMO_MODELS, demoBooks, demoMultiSourceModel, demoLiveSnapshot } from './demo-data.js';

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

/**
 * WinCC OA's own name matching, for the demo: `*` is any run, `?` one character, and
 * every other character is literal (a DP name may contain `.` and `_`).
 */
function matchesDpPattern(name: string, pattern: string): boolean {
  if (pattern === '' || pattern === '*') return true;
  const escaped = [...pattern]
    .map((ch) => {
      if (ch === '*') return '.*';
      if (ch === '?') return '.';
      // Anything else is literal in a DP name (`.`, `-`, `:`…), so it is escaped for the
      // regular expression rather than being allowed to mean something there.
      return /[a-z0-9_]/i.test(ch) ? ch : '\\' + ch;
    })
    .join('');
  return new RegExp(`^${escaped}$`, 'i').test(name);
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
    // The same resolution the backend does: a model's token (`EVENT`) becomes the project's
    // datapoint (`_NGA_G_EVENT`), so the demo cannot pass what a runtime would refuse.
    resolveArchiveGroup: async (group) => {
      const token = group.trim().replace(/^_NGA_G_/i, '').toLowerCase();
      return DEMO_ARCHIVE_GROUPS.find((candidate) => candidate === group.trim())
        ?? DEMO_ARCHIVE_GROUPS.find((candidate) => candidate.toLowerCase().includes(token))
        ?? DEMO_ARCHIVE_GROUPS[0];
    },
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
  /** Signals HIDDEN by hand, per book. An override, so a re-walk keeps them hidden. */
  private manualExcluded = new Map<string, Set<string>>();
  /** The fake OPC UA server the demo browses (drifts between generations). */
  private readonly browsePort = new DemoOpcUaBrowsePort();
  /** The fake S7-1500 station — the same port the `s7plusBrowse` manager implements. */
  private readonly s7plusPort = new DemoS7PlusBrowsePort();
  /** The demo's connection registry — a device save may ADD one (see saveDevice). */
  private readonly connections: EngConnection[] = structuredClone(DEMO_CONNECTIONS);
  private readonly s7plusConnections: EngS7PlusConnection[] = structuredClone(DEMO_S7PLUS_CONNECTIONS);
  /** Connections a demo save "set a password" on — drives the passwordSet indicator. */
  private readonly passwordSetOn = new Set<string>();
  /** One-shot seeding of the walker-produced online book. */
  private browseSeed: Promise<void> | null = null;
  private live: LiveSnapshot = demoLiveSnapshot();
  private workspace: Workspace = this.seedWorkspace();

  async roles(): Promise<Set<EngRole>> {
    return new Set<EngRole>(['view', 'edit-model', 'manage-devices', 'checkin']);
  }

  /**
   * What a caller sees: the stored book minus the signals hidden by hand, plus the
   * warning stating how many. Kept apart from what is STORED — exactly as the backend
   * does (see `engController.presented`) — so hiding a signal stays reversible.
   */
  private presented(book: AddressBook): AddressBook {
    const excluded = this.manualExcluded.get(book.id);
    if (excluded === undefined || excluded.size === 0) return book;
    const entries = withoutExcluded(book.entries, excluded);
    const hidden = book.entries.length - entries.length;
    return {
      ...book,
      entries,
      excludedPaths: [...excluded],
      warnings: hidden === 0 ? book.warnings : [excludedWarning(hidden, book.entries.length), ...book.warnings]
    };
  }

  /** Mutable in the demo, so the form's create/edit/delete actually persist. */
  private devices: Device[] = DEMO_DEVICES.map((device) => ({ ...device, state: 'unknown' }));

  async listDevices(): Promise<Device[]> {
    await this.ensureBrowsedBook();
    return this.devices.map((device) => this.withLiveState(device));
  }

  /**
   * The same derivation as `listDevices`, live fields only.
   *
   * DETERMINISTIC on purpose: the demo could flip a lamp every few seconds to show off
   * the refresh, but the docs and the screenshot pipeline read this gateway too, and a
   * state that moves on its own would make every capture a coin toss. The refresh being
   * exercised is what matters here; what it returns is the project's business.
   */
  async deviceStates(): Promise<DeviceStateUpdate[]> {
    const devices = await this.listDevices();
    return devices.map((device) => deviceStateOf(device));
  }

  /**
   * The same DERIVATION the backend does (see `engController.withLiveState`), so the
   * demo shows the state the way the real page will — INCLUDING the cases where nothing
   * can be read. A demo where every LED is green would teach an operator to expect a
   * state the project cannot always give.
   *
   * Same two steps as the backend: find the connection the declaration points at (an
   * OPC UA reference, else the declared address), then read its `ConnState` — here from
   * `DEMO_CONN_STATE` instead of a driver. A declaration with neither is `unprobed`, and
   * a device declared on a connection the demo project does not have is
   * `unknown-connection`; both stay `unknown`, never `disconnected`.
   */
  private withLiveState(device: Device): Device {
    const reference = this.opcUaConnectionOf(device);
    const connection = reference ?? declaredAddressOf(device);
    // Like the backend: the indicator reads the runtime's own record, never a store.
    const passwordSet =
      device.protocol === 'opcua' && reference !== null ? { passwordSet: this.passwordSetOn.has(reference.replace(/^_/, '')) } : {};
    if (connection === '') return { ...device, state: 'unknown', stateSource: 'unprobed' };
    const code = DEMO_CONN_STATE[device.id];
    if (code === undefined) {
      return { ...device, state: 'unknown', stateSource: 'unknown-connection', stateConnection: connection, ...passwordSet };
    }
    return {
      ...device,
      state: deviceStateFromConnState(code),
      stateSource: code === CONN_STATE.UNDEFINED_BY_DRIVER ? 'probe-failed' : 'connstate',
      stateConnection: connection,
      stateCode: code,
      ...passwordSet
    };
  }

  /** The OPC UA connection this device addresses through — as the backend resolves it. */
  private opcUaConnectionOf(device: Device): string | null {
    const declared = String(device.connection?.['server'] ?? '').trim();
    if (device.protocol === 'opcua' && declared !== '') return declared;
    for (const bookId of device.bookIds) {
      const iface = this.books.get(bookId)?.interface;
      const name = iface?.protocol === 'opcua' ? (iface.connection ?? '').trim() : '';
      if (name !== '') return name;
    }
    return null;
  }

  /**
   * Same contract as the backend, deliberately including its REFUSALS: validate
   * with the core, then normalise; an empty `id` creates (the id is derived here,
   * as the server does), a non-empty unknown one is an error rather than a silent
   * creation. A demo that is laxer than the real gateway teaches the wrong thing.
   */
  async saveDevice(id: string, draft: DeviceDraft): Promise<DeviceSaveResult> {
    const index = id === '' ? -1 : this.devices.findIndex((device) => device.id === id);
    if (id !== '' && index === -1) throw new Error(`unknown device '${id}'`);
    const others = this.devices.filter((device) => device.id !== id);
    const problems = blockingProblems(validateDevice({ ...draft, id }, others));
    if (problems.length > 0) throw new Error(problems.map((problem) => formatWarning(problem)).join(' '));
    const device = normalizeDevice({ ...draft, id }, others);
    if (index === -1) this.devices = [...this.devices, device];
    else this.devices = this.devices.map((existing, at) => (at === index ? { ...existing, ...device } : existing));
    const provision = this.provisionConnection(device);
    const security = this.applySecurity(device, draft);
    const devices = await this.listDevices();
    return {
      devices,
      ...(provision === null ? {} : { connectionProvision: provision }),
      ...(security === null ? {} : { connectionSecurity: security })
    };
  }

  /**
   * Mirror of the backend's `applyOpcUaSecurity`: the demo records what a live
   * deployment would write and toggles the password indicator — but it does NOT
   * pretend to encrypt (there is no runtime, no driver certificate). A demo that
   * simulated encryption would teach a guarantee it cannot give.
   */
  private applySecurity(device: Device, draft: DeviceDraft): ConnectionSecurity | null {
    if (device.protocol !== 'opcua') return null;
    const write = opcuaSecurityWrite(device.connection);
    const rawPassword = String((draft.connection ?? {})['password'] ?? '');
    if (write === null && rawPassword === '') return null;
    const server = String(device.connection?.['server'] ?? '')
      .trim()
      .replace(/^_/, '');
    const outcome: ConnectionSecurity = { applied: [], warnings: [] };
    if (server === '' || !this.connections.some((connection) => connection.name === server)) {
      outcome.warnings.push(`No _OPCUAServer connection matches "${server}" — the security settings were not applied.`);
      return outcome;
    }
    if (write !== null) {
      if (write.user !== undefined) outcome.applied.push('user');
      if (write.policy !== undefined) outcome.applied.push('policy');
      if (write.messageMode !== undefined) outcome.applied.push('mode');
      if (write.clientCertificate !== undefined) outcome.applied.push('certificate');
      if (Object.keys(write.flagBits).length > 0) outcome.applied.push('flags');
    }
    if (rawPassword !== '') {
      this.passwordSetOn.add(server);
      outcome.passwordSet = true;
      outcome.applied.push('password');
    }
    return outcome;
  }

  /**
   * Mirror of the backend's `provisionOpcUaConnection`: an OPC UA server name the
   * project does not carry is a request for a NEW connection, so the save creates
   * it — here by adding it to the demo's own connection list (disconnected, like a
   * freshly created `_OPCUAServer` whose driver has not picked it up yet). The demo
   * must teach the same behaviour as a live deployment, warnings included.
   */
  private provisionConnection(device: Device): ConnectionProvision | null {
    if (device.protocol !== 'opcua') return null;
    const server = String(device.connection?.['server'] ?? '').trim();
    if (server === '' || this.connections.some((connection) => connection.name === server.replace(/^_/, ''))) return null;
    const name = server.replace(/^_/, '');
    this.connections.push({ name, connected: false });
    const endpoint = String(device.connection?.['endpoint'] ?? '').trim();
    const warnings =
      endpoint === ''
        ? ['No endpoint declared — the connection was created with an empty ConnInfo; fill in the equipment\'s endpoint (opc.tcp://…) so the driver knows where to connect.']
        : [];
    return { name, dp: `_${name}`, created: true, warnings };
  }

  async deleteDevice(id: string): Promise<Device[]> {
    // Books are KEPT: a catalog may be shared with another equipment.
    if (!this.devices.some((device) => device.id === id)) throw new Error(`unknown device '${id}'`);
    this.devices = this.devices.filter((device) => device.id !== id);
    return this.listDevices();
  }

  async listBooks(): Promise<AddressBook[]> {
    await this.ensureBrowsedBook();
    return this.allPresented();
  }

  async getBook(bookId: string): Promise<AddressBook | null> {
    await this.ensureBrowsedBook();
    const book = this.books.get(bookId);
    return book === undefined ? null : this.presented(book);
  }

  /** The whole registry as a caller sees it (exclusions applied). */
  private allPresented(): AddressBook[] {
    return [...this.books.values()].map((book) => this.presented(book));
  }

  async listDrivers(): Promise<EngDriver[]> {
    return DEMO_DRIVERS.map((driver) => ({ ...driver }));
  }

  /**
   * The alarm classes and archive groups a WinCC OA project actually carries — the demo
   * uses the DEFAULT names of a fresh project rather than invented ones, so a screenshot
   * shows what an operator will really be offered.
   */
  /** The fake project's DP types — what a model may be started from. */
  async listDpTypes(): Promise<string[]> {
    return this.live.types.map((type) => type.typeName).sort((a, b) => a.localeCompare(b));
  }

  async readDpType(typeName: string): Promise<EngType> {
    const found = this.live.types.find((type) => type.typeName === typeName);
    if (found === undefined) throw new Error(`unknown DP type '${typeName}'`);
    return structuredClone(found);
  }

  async listConfigOptions(): Promise<EngConfigOptions> {
    return {
      alarmClasses: [...DEMO_ALARM_CLASSES],
      archiveGroups: [...DEMO_ARCHIVE_GROUPS],
      subscriptions: [...DEMO_SUBSCRIPTIONS],
      pollGroups: POLL_GROUPS.map((group) => group.name)
    };
  }

  /** What a search may match, by requested DP type ('' = the whole fake project). */
  private dpPoolFor(type?: string): string[] {
    if (type === '_AlertClass') return [...DEMO_ALARM_CLASSES];
    if (type === '_NGA_Group') return [...DEMO_ARCHIVE_GROUPS];
    return [...DEMO_ALARM_CLASSES, ...DEMO_ARCHIVE_GROUPS, ...this.workspace.dps.map((dp) => dp.dpName)];
  }

  /**
   * The demo's "project datapoints": its internal lists plus the workspace's own DPs, so
   * the magnifier has something realistic to find. `*` and `?` are honoured, like WinCC OA.
   */
  async searchDps(pattern: string, type?: string): Promise<{ dps: string[]; truncated: boolean }> {
    const pool = this.dpPoolFor(type);
    const hits = [...new Set(pool)].filter((name) => matchesDpPattern(name, pattern)).sort((a, b) => a.localeCompare(b));
    return { dps: hits.slice(0, 200), truncated: hits.length > 200 };
  }

  /**
   * Ingest a file into a catalog with the REAL core generators — the demo runs the
   * same code path as the backend, so a SimaticML export or a Control Expert CSV
   * dropped on the offline demo produces the book (and the warnings) a live
   * deployment would. Its refusals are the backend's too: a payload that does not
   * match the format is an error, not an empty book.
   */
  async ingestBook(request: IngestRequest): Promise<{ book: AddressBook; books: AddressBook[] }> {
    await this.ensureBrowsedBook();
    // The SAME core function the backend stores with and the form previews with.
    const book = buildBookFromIngest(request);
    const stored = qualify(book, this.manualRoles.get(book.id) ?? {}, this.manualAccess.get(book.id) ?? {});
    this.books.set(stored.id, stored);
    return { book: this.presented(stored), books: this.allPresented() };
  }

  /**
   * The demo's classic-S7 inventory — the FAKE CPU of `s7-fixtures.ts`.
   *
   * Same code path as a live one: the fixture stands in for what the `s7Browse`
   * manager returns, and the verdicts come from the very same core function the
   * backend calls. So the screenshots show real cross-check output, and the demo
   * exercises the disagreements that matter (a data block the CPU does not hold,
   * a block the catalog reads past the end of) rather than a happy path.
   */
  async s7Inventory(bookId: string, _target: { deviceId?: string; host?: string; rack?: number; slot?: number }): Promise<S7InventoryResult> {
    await this.ensureBrowsedBook();
    const book = this.books.get(bookId);
    if (book === undefined) throw new Error(`catalog '${bookId}' not found`);
    const inventory = { ...(S7_INVENTORY as S7Inventory), readAt: new Date().toISOString() };
    return { inventory, crossCheck: crossCheckBookAgainstInventory(this.presented(book), inventory) };
  }

  /**
   * The demo's classic-S7 connections — one CONNECTED, so the equipment's lamp is
   * green offline and the screenshots show a state rather than a grey unknown.
   */
  async listS7Connections(): Promise<EngConnection[]> {
    return [{ name: 'S7_Pompage', connected: true }];
  }

  /** The offline demo stands in for a deployed reader, so the action is shown. */
  async s7BrowseHealth(): Promise<{ reachable: boolean }> {
    return { reachable: true };
  }

  /** Create an EMPTY catalog — the "declare, then browse into it" first step. */
  async createBook(request: {
    bookId: string;
    name?: string;
    interface?: AddressBook['interface'];
  }): Promise<{ book: AddressBook; books: AddressBook[] }> {
    await this.ensureBrowsedBook();
    if (this.books.has(request.bookId)) throw new Error(`a catalog '${request.bookId}' already exists`);
    const book: AddressBook = {
      id: request.bookId,
      name: request.name ?? request.bookId,
      provenance: {
        kind: 'manual',
        generatedAt: new Date().toISOString(),
        detail: 'declared, not yet generated'
      },
      ...(request.interface === undefined ? {} : { interface: request.interface }),
      entries: [],
      types: [],
      warnings: []
    };
    this.books.set(book.id, book);
    return { book, books: this.allPresented() };
  }

  /** One level of the FAKE server — what the explorer and the walk are built on. */
  async browseLevel(connection: string, nodeId?: string): Promise<OpcUaBrowseNode[]> {
    return this.browsePort.browseLevel(connection, nodeId ?? OPCUA_OBJECTS_FOLDER);
  }

  /**
   * The client-driven walk, against the fake server. Same shared code path as the
   * live gateway (`data/walk.ts`), so the progress the demo shows is the progress a
   * deployment shows — one event per level, on the real walker.
   */
  async walkIntoBook(request: WalkRequest): Promise<BookRefresh> {
    await this.ensureBrowsedBook();
    const previous = this.books.get(request.bookId) ?? null;
    // A re-walk of an already-browsed book means the machine moved on since.
    if (previous !== null && previous.entries.length > 0) this.browsePort.advance();
    const { book, delta } = await runWalk(this.browsePort, previous, request);
    const stored = qualify(book, this.manualRoles.get(book.id) ?? {}, this.manualAccess.get(book.id) ?? {});
    this.books.set(stored.id, stored);
    return { book: this.presented(stored), rebrowsed: true, ...(delta === undefined ? {} : { delta }) };
  }

  /** Hide or restore signals by hand — an override, so a re-walk keeps it. */
  async saveBookExcluded(bookId: string, excluded: Record<string, boolean>): Promise<AddressBook> {
    const merged = new Set(this.manualExcluded.get(bookId) ?? []);
    for (const [path, hidden] of Object.entries(excluded)) {
      if (hidden) merged.add(path);
      else merged.delete(path);
    }
    this.manualExcluded.set(bookId, merged);
    const book = this.books.get(bookId);
    if (!book) throw new Error(`unknown book '${bookId}'`);
    return this.presented(book);
  }

  /** Forget a catalog and DETACH it from every equipment (as the backend does). */
  async deleteBook(bookId: string): Promise<BookDeletion> {
    await this.ensureBrowsedBook();
    if (!this.books.has(bookId)) throw new Error(`unknown book '${bookId}'`);
    this.books.delete(bookId);
    this.manualRoles.delete(bookId);
    this.manualAccess.delete(bookId);
    this.devices = this.devices.map((device) =>
      device.bookIds.includes(bookId) ? { ...device, bookIds: device.bookIds.filter((id) => id !== bookId) } : device
    );
    return { books: this.allPresented(), devices: await this.listDevices() };
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
    if (previous && previous.provenance.kind === 's7plus-browse' && source) {
      this.s7plusPort.advance(); // ditto: a program download since the last walk
      return this.walkS7PlusIntoBook({
        ...source,
        station: source.station ?? 'S7Plus$Online|Online',
        bookId,
        name: previous.name
      });
    }
    const fresh = demoBooks().find((b) => b.id === bookId);
    // A rules-only refresh KEEPS the operator's manual overrides.
    if (fresh) this.books.set(bookId, qualify(fresh, this.manualRoles.get(bookId) ?? {}, this.manualAccess.get(bookId) ?? {}));
    return {
      book: this.presented(this.books.get(bookId) as AddressBook),
      rebrowsed: false,
      note: 'Source hors ligne : seules les règles de qualification ont été rejouées.'
    };
  }

  async listConnections(): Promise<EngConnection[]> {
    return this.connections.map((connection) => ({ ...connection }));
  }

  async browseBook(request: BrowseRequest): Promise<BookRefresh> {
    await this.ensureBrowsedBook();
    return this.runBrowse(request);
  }

  // --- S7Plus (against the fake station) --------------------------------------

  /**
   * The demo answers `reachable: true`: the fake station stands in for the
   * `s7plusBrowse` manager, so pretending it is missing would only hide the
   * feature from the docs. `drivers` is stated too, because that is what a real
   * answer carries and the UI reads it.
   */
  async s7plusHealth(): Promise<S7PlusManagerHealth> {
    return { reachable: true, drivers: [3], connections: this.s7plusConnections.length };
  }

  async listS7PlusConnections(): Promise<EngS7PlusConnection[]> {
    return this.s7plusConnections.map((connection) => ({ ...connection }));
  }

  async listS7PlusProjects(connection: string): Promise<EngS7PlusProject[]> {
    const nodes = await this.s7plusPort.browseLevel(connection, '', true);
    return nodes
      .filter((node) => node.systemType === 'Project')
      .map((node) => ({ name: node.nodePath, online: node.nodePath === 'S7Plus$Online' }));
  }

  async listS7PlusStations(connection: string, project: string): Promise<EngS7PlusStation[]> {
    const nodes = await this.s7plusPort.browseLevel(connection, project, true);
    return nodes
      .filter((node) => node.systemType === 'Station')
      .map((node) => {
        const name = node.nodePath.split('|')[0];
        return { name, station: `${project}|${name}` };
      });
  }

  async browseS7PlusLevel(connection: string, item?: string, hmiVisibleOnly?: boolean): Promise<S7PlusBrowseNode[]> {
    return this.s7plusPort.browseLevel(connection, item ?? '', hmiVisibleOnly !== false);
  }

  /**
   * The client-driven S7Plus walk, against the fake station — same shared code path
   * as the live gateway (`data/walk.ts`), so the progress and the delta the demo
   * shows are the ones a deployment shows.
   */
  async walkS7PlusIntoBook(request: S7PlusWalkRequest): Promise<BookRefresh> {
    await this.ensureBrowsedBook();
    const previous = this.books.get(request.bookId) ?? null;
    // A re-walk of an already-browsed book means the program moved on since.
    if (previous !== null && previous.entries.length > 0) this.s7plusPort.advance();
    const { book, delta } = await runS7PlusWalk(this.s7plusPort, previous, request);
    const stored = qualify(book, this.manualRoles.get(book.id) ?? {}, this.manualAccess.get(book.id) ?? {});
    this.books.set(stored.id, stored);
    return { book: this.presented(stored), rebrowsed: true, ...(delta === undefined ? {} : { delta }) };
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
      book: this.presented(stored),
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

  /** `''` clears an override — the same merge semantics as the backend's store. */
  async saveBookRoles(bookId: string, roles: Record<string, SignalRole | ''>): Promise<void> {
    const merged = { ...(this.manualRoles.get(bookId) ?? {}) };
    for (const [path, role] of Object.entries(roles)) {
      if (role === '') delete merged[path];
      else merged[path] = role;
    }
    this.manualRoles.set(bookId, merged);
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

  /**
   * Saved models live for the session — enough to demo authoring then reusing one.
   *
   * THREE are SEEDED, because the Model tab is a list of models: an empty one would show
   * the feature's empty state rather than the feature. Together they are the three shapes
   * a house standard takes — an authored structure mapped onto a catalog with its
   * deployment pinned (`STD_Four`), one mirrored from a mutualised catalog
   * (`STD_PackML`), and one mirrored from TWO catalogs of the same station
   * (`STD_Pompage`, built by the core so the demo cannot show an impossible shape).
   */
  private models = new Map<string, ModelTemplate>(
    [...DEMO_MODELS, demoMultiSourceModel([...this.books.values()])].map((model) => [model.id, model])
  );

  async listModels(): Promise<ModelTemplate[]> {
    return [...this.models.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveModel(model: ModelTemplate): Promise<ModelTemplate> {
    const stored: ModelTemplate = {
      ...model,
      id: model.id && model.id.trim() !== '' ? model.id : templateIdFrom(model.name),
      savedAt: new Date().toISOString()
    };
    this.models.set(stored.id, stored);
    return stored;
  }

  async deleteModel(id: string): Promise<void> {
    if (!this.models.delete(id)) throw new Error(`unknown model '${id}'`);
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

  async checkin(plan: EngPlan, dryRun: boolean, recreate = false): Promise<ApplyReport> {
    const port = demoPort(this.live);
    const previousConfigs = Object.fromEntries(Object.entries(this.live.configs));
    const report = await applyPlan(plan, port, { dryRun, previousConfigs, recreate });
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
