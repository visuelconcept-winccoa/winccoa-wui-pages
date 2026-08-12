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
  LiveSnapshot,
  ModelTemplate,
  OpcUaBrowseNode,
  SignalRole,
  TagAccess,
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

/** One OPC UA server connection of the project, offered for browsing. */
export interface EngConnection {
  /** Reference name (no leading `_`), as used in an address reference. */
  name: string;
  connected: boolean;
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
  format: 'simaticml' | 'xvm' | 'csv' | 'nodeset';
  /** Source file name, recorded in the book's provenance. */
  file?: string;
  interface?: AddressBook['interface'];
  /** `simaticml` only: a TIA export is a BUNDLE of documents. */
  documents?: { fileName: string; xml: string }[];
  /** `xvm` / `nodeset`: the XML document. */
  xml?: string;
  /** `csv`: the Control Expert variables export. */
  text?: string;
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
   * discard whatever another operator added since). Returns the fresh registry.
   * Rejects with the validation message when the backend refuses the draft.
   */
  saveDevice(id: string, draft: DeviceDraft): Promise<Device[]>;
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
   * Walk a live OPC UA server into a book and store it under `bookId`.
   * Replaces a book of the same id — that is what a "re-browse" is.
   */
  browseBook(request: BrowseRequest): Promise<BookRefresh>;
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
  checkin(plan: EngPlan, dryRun: boolean): Promise<ApplyReport>;

  // --- validation -------------------------------------------------------------
  /** Read current values for a set of DPEs via the device connection. */
  testRead(dpes: string[]): Promise<TestReadResult[]>;
}
