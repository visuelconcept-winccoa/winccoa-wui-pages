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
  BrowseProgress,
  Device,
  DeviceDraft,
  DeviceStateUpdate,
  EngPlan,
  EngType,
  LiveSnapshot,
  ModelTemplate,
  OpcUaBrowseNode,
  S7CrossCheck,
  S7Inventory,
  S7PlusBrowseNode,
  S7PlusBrowseProgress,
  SignalRole,
  TagAccess,
  Workspace
} from '@visuelconcept-winccoa/wui-eng-core';

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

/** One OPC UA server connection of the project, offered for browsing. */
export interface EngConnection {
  /** Reference name (no leading `_`), as used in an address reference. */
  name: string;
  connected: boolean;
}

/**
 * One S7Plus connection (`_S7PlusConnection`) of the project, offered for browsing.
 *
 * Richer than {@link EngConnection} because an S7Plus browse needs more than a
 * name to start: it reads a TIA **source** (`station`), through a **driver** that
 * has to be running, and the connection's own state decides whether an ONLINE walk
 * can work at all. All of it is read from the project — never typed from memory.
 */
export interface EngS7PlusConnection {
  name: string;
  connected: boolean;
  /** Raw `Common.State.ConnState`, when it was read. */
  connState?: number;
  /**
   * `Config.StationName`: the `project|station` the WinCC OA side is already
   * configured for (or the reserved online marker) — offered as the default source.
   */
  station?: string;
  driverNumber?: number;
  address?: string;
  /** Why this connection could not be fully read (never fatal). */
  error?: string;
}

/** One browsable S7Plus source: a TIA export, or the reserved online project. */
export interface EngS7PlusProject {
  name: string;
  /** True for `S7Plus$Online` — a walk of it reads the live PLC. */
  online: boolean;
}

/** One station of a TIA project, with the `project|station` item to walk. */
export interface EngS7PlusStation {
  name: string;
  station: string;
}

/**
 * An S7Plus walk driven by the PAGE, one level at a time — the exact counterpart of
 * {@link WalkRequest}, with a TIA `project|station` where OPC UA has a node id.
 */
export interface S7PlusWalkRequest {
  bookId: string;
  connection: string;
  /** `<project>|<station>`, or the reserved `S7Plus$Online|Online`. */
  station: string;
  name?: string;
  /** Sub-tree item to walk (defaults to the station). */
  root?: string;
  /** The driver's "Visible in HMI Engineering" filter (default true). */
  hmiVisibleOnly?: boolean;
  driverNumber?: number;
  maxDepth?: number;
  maxEntries?: number;
  maxRequests?: number;
  maxArrayElements?: number;
  /** Called on every browse request; THROW from it to cancel the walk. */
  onProgress?: (progress: S7PlusBrowseProgress) => void;
}

/**
 * Whether the dedicated S7Plus browse manager answers, and what it can see.
 *
 * The page asks because "no S7Plus connection in this project" and "the browse
 * service is not installed" are different problems with different fixes — and only
 * the second one is about the studio.
 */
export interface S7PlusManagerHealth {
  reachable: boolean;
  /** Running S7Plus driver manager numbers, when the manager could tell. */
  drivers?: number[];
  connections?: number;
  error?: string;
}

/**
 * One driver of the project, as the device form offers it.
 *
 * `driverNumber` is the manager number every `_address` write of the equipment
 * lands on: the form OFFERS the project's drivers rather than asking an engineer
 * to remember a number, because a wrong one silently binds the datapoint to
 * another driver. Stopped drivers are listed too (an equipment is declared before
 * its driver is started) — with their state, never filtered out.
 */
export interface EngDriver {
  /** Manager number (`_Driver<n>`). */
  number: number;
  /** Raw driver type (`_Driver<n>.DT`: 'OPCUAC', 'S7', 'MODBUS'…), '' when unknown. */
  type: string;
  /**
   * ABSENT when the backend could not read the running set — which is not "stopped".
   * Labelling a live driver as down is a false claim, so the picker shows the three
   * states it can actually distinguish.
   */
  running?: boolean;
  /** Access mode, only for the driver types whose mapping is verified (OPC UA). */
  mode?: string;
}

/**
 * What the deployment decisions of a model may refer to, read from the project.
 *
 * Two lists rather than free text because both are DATAPOINT NAMES: `_alert_hdl.._class`
 * must name an existing `_AlertClass` instance and `_archive.1._class` an `_NGA_Group`
 * one, so a value typed from memory yields a config the runtime rejects. Both may be
 * empty — "could not tell" — and the editor then accepts free entry.
 */
export interface EngConfigOptions {
  alarmClasses: string[];
  archiveGroups: string[];
  /**
   * OPC UA SUBSCRIPTIONS of the project (`_OPCUASubscription` datapoints, without their leading
   * underscore) — what a subscribed leaf is written through, and where the publishing interval and
   * the deadband live. Empty means the project has none: the studio then keeps offering polling
   * only, because an address subscribed to nothing is a polled address.
   */
  subscriptions: string[];
  /** The poll groups the studio offers and creates (`POLL_GROUPS` of the core). */
  pollGroups: string[];
}

/**
 * Ingest an address book from a FILE — the path that creates a catalog without
 * any equipment and without touching a machine (see the Catalogues panel).
 *
 * The payload is the union of what the four generators need; the backend picks by
 * `format` and refuses a mismatch, so a `csv` with no `text` is an error rather
 * than an empty book. `interface` binds the catalog to a live connection where
 * that makes sense (a project export carries its own PLC interface) and is
 * IGNORED for `nodeset`: a NodeSet's namespace indices are file-local, so it is
 * always a template catalog bound per equipment at generation.
 */
export interface IngestRequest {
  bookId: string;
  name?: string;
  format: 'simaticml' | 's7sym' | 's7awl' | 'xvm' | 'csv' | 'nodeset';
  /** Source file name, recorded in the book's provenance. */
  file?: string;
  interface?: AddressBook['interface'];
  /** `simaticml` only: a TIA export is a BUNDLE of documents. */
  documents?: { fileName: string; xml: string }[];
  /** `xvm` / `nodeset`: the XML document. */
  xml?: string;
  /** `csv`: the Control Expert variables export. `s7sym`: the symbol table. */
  text?: string;
  /** `s7awl`: the AWL/STL sources (plain text — one file may declare several blocks). */
  sources?: { fileName: string; text: string }[];
  /**
   * `s7awl`: a symbol table ingested beside the sources, read for its BLOCK
   * DIRECTORY only — it is what names a data block `Echange` instead of `DB10`.
   * The addresses are identical with or without it.
   */
  symbolText?: string;
}

/**
 * What the CPU of a classic S7 equipment answers about itself and its blocks.
 *
 * Requested per catalog, never stored: it is a reading of the MACHINE, while the
 * catalog is a reading of the PROJECT, and the whole value of asking is that the
 * two can disagree. See the core's `s7/inventory.ts`.
 */
export interface S7InventoryResult {
  inventory: S7Inventory;
  crossCheck: S7CrossCheck;
}

/** Both registries a catalog deletion changes (it detaches from every device). */
export interface BookDeletion {
  books: AddressBook[];
  devices: Device[];
}

/** Parameters of an online browse (see the core's `BrowseSource`). */
export interface BrowseRequest {
  bookId: string;
  connection: string;
  name?: string;
  rootNodeId?: string;
  maxDepth?: number;
  maxEntries?: number;
}

/**
 * A walk driven by the PAGE, one level at a time, so it can report progress.
 *
 * `/books/browse` walks everything server-side and answers once — minutes later on a
 * real server, with nothing to show meanwhile and no way to explore first. So the
 * page runs the core's own walker over {@link EngGateway.browseLevel} instead: same
 * verified code, one HTTP round-trip per level, and a progress event per request.
 */
export interface WalkRequest {
  bookId: string;
  connection: string;
  name?: string;
  rootNodeId?: string;
  driverNumber?: number;
  maxDepth?: number;
  maxEntries?: number;
  /** Called on every browse request; THROW from it to cancel the walk. */
  onProgress?: (progress: BrowseProgress) => void;
}

/** Paths touched by a re-read of a book's source. */
export interface BookDelta {
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Result of a refresh / browse. `delta` is present only when the SOURCE was
 * actually re-read and a previous version existed — a refresh that merely re-runs
 * the rules has nothing to compare. `removed` is the dangerous half: those
 * signals may still be referenced by a workspace.
 */
export interface BookRefresh {
  book: AddressBook;
  /** True when the live source was re-read (as opposed to rules-only). */
  rebrowsed: boolean;
  delta?: BookDelta;
  /** Why the source could not be re-read, when it could not. */
  note?: string;
}

/**
 * What a device save did about the connection the equipment declares.
 *
 * Present only when the declared OPC UA server matched no project connection —
 * i.e. when the declaration was a request for a NEW connection. `created` says
 * whether its `_OPCUAServer` datapoint was written; `warnings` carry what is
 * still missing (no endpoint declared, no driver to register with, or why the
 * creation failed). A failure never fails the device save itself.
 */
export interface ConnectionProvision {
  /** Connection name as the device declares it (the `_address` reference). */
  name: string;
  /** The `_OPCUAServer` datapoint, when it was created. */
  dp?: string;
  created: boolean;
  warnings: string[];
}

/**
 * What a save did about the connection's SECURITY settings (OPC UA user,
 * password, policy, certificate flags). `passwordSet` is present only when a
 * password was pushed, and reports what the runtime's blob READS BACK — the
 * studio never stores the secret, so that is the only honest statement.
 */
export interface ConnectionSecurity {
  applied: string[];
  passwordSet?: boolean;
  warnings: string[];
}

/** Registry after a device save, plus the connection provisioning outcome. */
export interface DeviceSaveResult {
  devices: Device[];
  connectionProvision?: ConnectionProvision;
  connectionSecurity?: ConnectionSecurity;
}

export interface EngGateway {
  /** Whether this gateway is the offline demo (drives a visible banner). */
  readonly isDemo: boolean;

  /** Roles granted to the current user (open-by-default like the rest of the suite). */
  roles(): Promise<Set<EngRole>>;

  // --- devices + address books (many-to-many) ---------------------------------
  /** Equipments — each carries `bookIds` (see the N:N relation in the model). */
  listDevices(): Promise<Device[]>;
  /**
   * The LIVE fields only (connection state + why), for the page's periodic refresh.
   *
   * Apart from `listDevices` on purpose: a state refresh runs on a timer, and answering
   * it with the whole registry would let a poll overwrite an equipment the operator is
   * editing with a copy that is seconds old.
   */
  deviceStates(): Promise<DeviceStateUpdate[]>;
  /**
   * Create or update ONE equipment (a single-device upsert, not a registry
   * replacement: replacing the list from a UI that loaded it minutes ago would
   * discard whatever another operator added since). Returns the fresh registry,
   * plus what the save did about the DECLARED connection when it did not exist
   * yet (an OPC UA server name the project does not carry is a request for a
   * NEW connection: the save creates its `_OPCUAServer` datapoint).
   * Rejects with the validation message when the backend refuses the draft.
   */
  saveDevice(id: string, draft: DeviceDraft): Promise<DeviceSaveResult>;
  /**
   * Forget an equipment. Its BOOKS are kept — the relation is many-to-many, so a
   * catalog may be shared — and nothing already checked in is touched.
   */
  deleteDevice(id: string): Promise<Device[]>;
  /** Every address book (registry). A book may be referenced by several devices. */
  listBooks(): Promise<AddressBook[]>;
  /** One book by its id, or null. */
  getBook(bookId: string): Promise<AddressBook | null>;
  /**
   * (Re)generate a book from its configured source. An `opcua-browse` book with
   * replayable browse parameters is **re-browsed on the live server**; any other
   * book only has its role rules re-run (the server does not keep the uploaded
   * document — re-ingest to regenerate a file catalog).
   */
  refreshBook(bookId: string): Promise<BookRefresh>;

  /**
   * Build a book from a FILE and store it — no equipment involved, no machine
   * touched. Returns the fresh registry alongside the book: an ingestion adds a row
   * to a list the caller is already showing, and re-fetching it would race.
   */
  ingestBook(request: IngestRequest): Promise<{ book: AddressBook; books: AddressBook[] }>;

  /**
   * Read the block directory of a classic-S7 CPU and compare it with a catalog.
   *
   * The counterpart of a re-browse for a protocol that HAS no browse: an S7-300/400
   * answers which blocks exist and how big they are, never a symbol, so the online
   * side cannot regenerate the catalog — it can only say how far the project export
   * it was built from is still true. Nothing is written: the answer is a reading of
   * the machine, shown beside the catalog for the operator to act on.
   *
   * `deviceId` is preferred to a typed address — the equipment already declares its
   * ip/rack/slot, and a second declaration is a second thing to keep in step.
   */
  s7Inventory(bookId: string, target: { deviceId?: string; host?: string; rack?: number; slot?: number }): Promise<S7InventoryResult>;

  /**
   * Is the classic-S7 reader deployed?
   *
   * Asked because its absence is NOT a degradation: an S7-300/400 catalog is built
   * from the STEP 7 exports and is complete without any manager. Only the online
   * cross-check needs it, so the page hides that one action rather than showing it
   * fail — "the reader is not installed" and "this catalog cannot be checked" are
   * different statements, and only the first is about the studio.
   */
  s7BrowseHealth(): Promise<{ reachable: boolean }>;

  /**
   * The project's classic-S7 connections (`_S7_Conn`), for the device form.
   *
   * An equipment that NAMES its connection gets an exact state read; one that does
   * not can only be matched by searching its IP in the connection's address, which
   * says nothing when two stations share it. So the form offers the list, exactly
   * as it does for OPC UA.
   */
  listS7Connections(): Promise<EngConnection[]>;

  /**
   * Create an EMPTY catalog (identity + interface only).
   *
   * What makes "declare the catalog, then browse into it" possible: a walk of a large
   * server takes minutes, so the identity is committed first — the operator is not
   * holding a form open while it runs, and a walk that fails half-way leaves a
   * catalog to retry into rather than nothing.
   */
  createBook(request: { bookId: string; name?: string; interface?: AddressBook['interface'] }): Promise<{
    book: AddressBook;
    books: AddressBook[];
  }>;

  /** Direct children of one node of an OPC UA address space (one round-trip). */
  browseLevel(connection: string, nodeId?: string): Promise<OpcUaBrowseNode[]>;

  /**
   * Walk a live server into a book from the PAGE, reporting progress as it goes.
   * Same result as {@link browseBook}, but level by level — see {@link WalkRequest}.
   */
  walkIntoBook(request: WalkRequest): Promise<BookRefresh>;

  /**
   * HIDE or restore signals of a book by hand (`{path: true}` hides, `false`
   * restores). Stored apart from the book like the role and access overrides, so a
   * re-browse keeps the operator's choices and nothing is ever really lost.
   */
  saveBookExcluded(bookId: string, excluded: Record<string, boolean>): Promise<AddressBook>;

  /**
   * Forget a catalog. It is DETACHED from every equipment that referenced it (the
   * relation is many-to-many, so both registries come back), and nothing already
   * checked in is touched.
   */
  deleteBook(bookId: string): Promise<BookDeletion>;

  /** OPC UA connections available for an online browse (empty in the demo). */
  listConnections(): Promise<EngConnection[]>;

  /**
   * The project's drivers, offered as the equipment's `driverNumber`. An empty list
   * means "could not tell" (no runtime, no permission) — the form then falls back to
   * free entry rather than blocking the declaration.
   */
  listDrivers(): Promise<EngDriver[]>;

  /**
   * What a per-leaf deployment decision may REFER TO in this project: the alarm classes
   * (`_AlertClass` datapoints) and the usable archive groups (`_NGA_Group`).
   *
   * An empty list means "could not tell" and the editor falls back to free entry: a class
   * or a group created after this read must stay usable, and an alarm class is a
   * datapoint name — one typed from memory produces a config the runtime rejects, so
   * offering the project's own list is what makes the decision safe.
   */
  listConfigOptions(): Promise<EngConfigOptions>;

  /**
   * Search the project's DATAPOINTS by pattern (WinCC OA wildcards), optionally of one DP
   * type — what the model editor's magnifier offers when the value wanted is a datapoint
   * the studio's own lists do not carry.
   *
   * Capped by the backend, which reports the truncation rather than pretending the answer
   * is complete: `*` on a real project matches tens of thousands of names.
   */
  searchDps(pattern: string, type?: string): Promise<{ dps: string[]; truncated: boolean }>;

  /**
   * The project's own DP TYPES (names, internal ones excluded) — what a model may be started
   * from when the type already exists, which is the normal case on a project engineered in
   * PARA before the studio arrived.
   */
  listDpTypes(): Promise<string[]>;

  /** One DP type's structure, read on demand (a picker must not read them all). */
  readDpType(typeName: string): Promise<EngType>;

  /**
   * Walk a live OPC UA server into a book and store it under `bookId`.
   * Replaces a book of the same id — that is what a "re-browse" is.
   */
  browseBook(request: BrowseRequest): Promise<BookRefresh>;

  // --- S7Plus (S7-1200/1500 symbolic) ----------------------------------------
  // The same three shapes as OPC UA — list the sources, one level, one walk —
  // kept as their OWN methods rather than a `protocol` parameter: the two
  // protocols address a node differently (a TIA `project|station` path versus a
  // node id), and a union that hides that would only move the branching into the
  // callers.

  /** Whether the S7Plus browse manager answers (and what it sees). */
  s7plusHealth(): Promise<S7PlusManagerHealth>;
  /** The project's S7Plus connections (empty in the demo without one). */
  listS7PlusConnections(): Promise<EngS7PlusConnection[]>;
  /** The browsable sources of a connection: TIA exports + the online project. */
  listS7PlusProjects(connection: string): Promise<EngS7PlusProject[]>;
  /** The stations of one TIA project. */
  listS7PlusStations(connection: string, project: string): Promise<EngS7PlusStation[]>;
  /** Children of one item of an S7Plus station (one round-trip). */
  browseS7PlusLevel(connection: string, item?: string, hmiVisibleOnly?: boolean): Promise<S7PlusBrowseNode[]>;
  /** Walk a station into a book from the page, reporting progress as it goes. */
  walkS7PlusIntoBook(request: S7PlusWalkRequest): Promise<BookRefresh>;
  /**
   * Persist the operator's MANUAL role overrides of a book (path → role).
   * Rule-derived roles are recomputed, manual ones are kept.
   *
   * `''` CLEARS an override, handing the signal back to the rule engine. Tagging a
   * role has to be undoable: a manual role outranks every rule, so without this a
   * mis-click would pin a wrong role for good and no amount of "Apply the rules"
   * would shift it.
   */
  saveBookRoles(bookId: string, roles: Record<string, SignalRole | ''>): Promise<void>;

  /**
   * Persist MANUAL access overrides (path → `r`/`w`/`rw`; `''` clears one).
   * This is what makes a browse without `AccessLevel` usable: an override counts
   * as evidence, so the generated address direction follows it.
   */
  saveBookAccess(bookId: string, access: Record<string, TagAccess | ''>): Promise<void>;

  // --- reusable model templates ----------------------------------------------
  /**
   * The project's saved models. A model is a type's structure plus how its leaves
   * reach a catalog — authored once, applied to equipment after equipment.
   */
  listModels(): Promise<ModelTemplate[]>;
  /** Create or replace one (the id is derived from the name when absent). */
  saveModel(model: ModelTemplate): Promise<ModelTemplate>;
  deleteModel(id: string): Promise<void>;

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
  /**
   * Apply the plan. `recreate` is DESTRUCTIVE and opt-in: without it an existing DP type is
   * CHANGED in place and an existing datapoint is left alone (only its configs are
   * written) — which is what keeps a running project's datapoints, their configs and their
   * archived values. With it, both are deleted and re-made.
   */
  checkin(plan: EngPlan, dryRun: boolean, recreate?: boolean): Promise<ApplyReport>;

  // --- validation -------------------------------------------------------------
  /** Read current values for a set of DPEs via the device connection. */
  testRead(dpes: string[]): Promise<TestReadResult[]>;
}
