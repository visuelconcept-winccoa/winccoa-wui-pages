// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// EngController — backend of the Engineering Studio page (/api/eng).
// -----------------------------------------------------------------------------
// The engineering LOGIC lives in the pure `@visuelconcept/wui-eng-core` (diff,
// plan applier, atomic config builders, config read-back mapping, address-book
// generators, role rules) — unit-tested with no runtime. This controller is the
// THIN runtime seam:
//
//   * it implements the core's `EngPort` over the shared WinCC OA API
//     (WsjServerGlobal.winccoa) — the ONLY place the engine touches OA;
//   * it reads the live project back into the core's `LiveSnapshot` shape
//     (types, datapoints and, for the requested DPEs, their configs);
//   * it resolves the DEVICE context of an address write (driver manager number +
//     ensured poll-group DP);
//   * it persists devices / books / workspaces / role overrides through EngStore
//     (JSON files — engineering data, see engStore.ts);
//   * it ingests address books from the file generators (SimaticML, XVM, CSV).
//
// No dedicated manager: everything runs against WsjServerGlobal.winccoa, as
// paraController and tagImporterController already do.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';
import { WinccoaDpTypeNode } from 'winccoa-manager';
import {
  DEFAULT_ROLE_RULES,
  applyPlan,
  baselineOf,
  buildBookFromNodeSet,
  buildBookFromOpcUaBrowse,
  buildBookFromSchneiderExport,
  buildBookFromSimaticMl,
  buildBookFromXvm,
  classifyEntries,
  configReadPaths,
  configsFromRaw,
  diffBooks,
  diffWorkspace,
  liveScopeOf,
  asEngWarnings,
  refreshWarnings,
  withAccess,
  withRoles,
  type AddressBook,
  type AddressConfig,
  type BookDiff,
  type Device,
  type DpTypeStructure,
  type DpeConfigs,
  type EngPlan,
  type EngPort,
  type LiveSnapshot,
  type SignalRole,
  type TagAccess,
  type Workspace
} from '@visuelconcept/wui-eng-core';

import { EngStore } from './engStore';
import { WinccoaOpcUaBrowsePort, listOpcUaConnections } from './engOpcuaBrowse';
import { identityOf, roleAssignments, roleGranted } from './appSecurityGuard';

/* eslint-disable @typescript-eslint/no-explicit-any */
function win(): any {
  return WsjServerGlobal.winccoa as any;
}

/** Element-type map (mirrors paraTypeNode / tagImporterController). */
const ELEMENT_TYPE_MAP: Record<string, number> = {
  Struct: 1, Int: 21, Float: 22, Bool: 23, Bit32: 24, String: 25, Time: 26, Dpid: 27,
  Char: 19, UInt: 20, Typeref: 41, LangString: 42, Blob: 46, Long: 54, ULong: 58, Bit64: 50,
  DynChar: 3, DynUInt: 4, DynInt: 5, DynFloat: 6, DynBool: 7, DynBit32: 8, DynString: 9,
  DynTime: 10, DynDpid: 29, DynLangString: 44, DynBlob: 48, DynBit64: 51, DynLong: 55, DynULong: 59
};

const ELEMENT_TYPE_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(ELEMENT_TYPE_MAP).map(([name, value]) => [value, name])
);

/** Default poll-group DP the studio ensures for its polled addresses. */
const DEFAULT_POLL_GROUP = '_EngStudio_Poll';
/** Poll interval (ms) of a poll group created by the studio. */
const DEFAULT_POLL_INTERVAL_MS = 1000;
/** Driver-type strings of `_Driver<n>.DT`, per access mode (OPCUAC verified). */
const DRIVER_TYPE_BY_MODE: Record<string, string> = { opcua: 'OPCUAC' };
/** Max DPEs read per dpGet batch (a config read is 16 attributes per DPE). */
const READ_BATCH = 40;

function buildTypeNode(node: DpTypeStructure): WinccoaDpTypeNode {
  const elementType = ELEMENT_TYPE_MAP[node.type];
  if (elementType === undefined) throw new Error(`Invalid element type '${node.type}' for '${node.name}'`);
  const children = (node.children ?? []).map((c) => buildTypeNode(c));
  return new WinccoaDpTypeNode(node.name, elementType, node.refName ?? '', children);
}

/** WinccoaDpTypeNode → DpTypeStructure (reverse of buildTypeNode). */
function structureOf(node: any): DpTypeStructure {
  const out: DpTypeStructure = { name: node.name, type: ELEMENT_TYPE_NAME[node.type] ?? String(node.type) };
  if (node.refName) out.refName = node.refName;
  if (node.children && node.children.length > 0) out.children = node.children.map((c: any) => structureOf(c));
  return out;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The core's {@link EngPort} over WsjServerGlobal.winccoa — the only place the
 * engineering engine touches the runtime. The device context of an address
 * (driver number + poll group) is resolved from the STORED device first (explicit
 * beats guessing), then auto-detected for the protocols where detection is
 * verified.
 */
class WinccoaEngPort implements EngPort {
  private readonly pollGroups = new Map<string, string>();

  constructor(private readonly devices: Device[]) {}

  async typeExists(typeName: string): Promise<boolean> {
    try {
      win().dpTypeGet(typeName);
      return true;
    } catch {
      return false;
    }
  }
  async dpTypeCreate(structure: DpTypeStructure): Promise<void> {
    const ok = await win().dpTypeCreate(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeCreate('${structure.name}') returned false`);
  }
  async dpTypeChange(structure: DpTypeStructure): Promise<void> {
    const ok = await win().dpTypeChange(buildTypeNode(structure));
    if (!ok) throw new Error(`dpTypeChange('${structure.name}') returned false`);
  }
  async dpTypeDelete(typeName: string): Promise<void> {
    const ok = await win().dpTypeDelete(typeName);
    if (!ok) throw new Error(`dpTypeDelete('${typeName}') returned false`);
  }
  async dpExists(dpName: string): Promise<boolean> {
    const w = win();
    try {
      return Boolean(w.dpExists(dpName)) || Boolean(w.dpExists(`${dpName}.`));
    } catch {
      return false;
    }
  }
  async dpCreate(dpName: string, dpType: string): Promise<void> {
    const ok = await win().dpCreate(dpName, dpType);
    if (!ok) throw new Error(`dpCreate('${dpName}','${dpType}') returned false`);
  }
  async dpDelete(dpName: string): Promise<void> {
    const ok = await win().dpDelete(dpName);
    if (!ok) throw new Error(`dpDelete('${dpName}') returned false`);
  }
  async dpSetWait(dpes: string[], values: unknown[]): Promise<void> {
    const ok = dpes.length === 1 ? await win().dpSetWait(dpes[0], values[0]) : await win().dpSetWait(dpes, values);
    if (!ok) throw new Error(`dpSetWait failed for ${dpes[0]}${dpes.length > 1 ? ` (+${dpes.length - 1} more)` : ''}`);
  }

  /**
   * Driver manager number + ensured poll-group DP for one address.
   *
   * Order: the stored device's `driverNumber` (declared by the engineer) → the
   * running driver auto-detected for the protocol (only OPC UA's `_Driver<n>.DT`
   * value is verified) → a clear error, because writing an address to the wrong
   * driver silently breaks the binding.
   */
  async resolveAddressContext(config: AddressConfig): Promise<{ driverNumber: number; pollGroupDp: string }> {
    const device = this.devices.find((d) => d.id === config.deviceId);
    const pollGroupDp = await this.ensurePollGroup(device?.pollGroup ?? DEFAULT_POLL_GROUP);
    if (device?.driverNumber !== undefined) {
      return { driverNumber: device.driverNumber, pollGroupDp };
    }
    const detected = await this.detectDriver(config.mode);
    if (detected !== null) {
      return { driverNumber: detected, pollGroupDp };
    }
    throw new Error(
      `no driver number for device '${config.deviceId ?? '?'}' (mode '${config.mode ?? '?'}') — set driverNumber on the device or start the driver`
    );
  }

  /** Manager numbers of running drivers (`_Connections.Driver.ManNums`). */
  private async runningDriverNums(): Promise<number[]> {
    try {
      const raw = await win().dpGet('_Connections.Driver.ManNums');
      const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
      const list = Array.isArray(value) ? value : value == null ? [] : [value];
      return list.map((x) => Number(x)).filter((n) => Number.isInteger(n));
    } catch {
      return [];
    }
  }

  /** First running driver whose `DT` matches the mode; null when unknown. */
  private async detectDriver(mode: AddressConfig['mode']): Promise<number | null> {
    const wanted = mode === undefined ? undefined : DRIVER_TYPE_BY_MODE[mode];
    if (wanted === undefined) return null; // only verified mappings are auto-detected
    for (const num of await this.runningDriverNums()) {
      try {
        const dt = await win().dpGet(`_Driver${num}.DT`);
        const value = Array.isArray(dt) ? dt[0] : dt;
        if (value === wanted) return num;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Ensure the poll-group DP exists (type `_PollGroup`, active); cached. */
  private async ensurePollGroup(pollGroup: string): Promise<string> {
    const cached = this.pollGroups.get(pollGroup);
    if (cached !== undefined) return cached;
    const normalized = pollGroup.startsWith('_') ? pollGroup : `_${pollGroup}`;
    if (!(await this.dpExists(normalized))) {
      const created = await win().dpCreate(normalized, '_PollGroup');
      if (!created) throw new Error(`failed to create poll group ${normalized}`);
      await win().dpSetWait([`${normalized}.Active`, `${normalized}.PollInterval`], [1, DEFAULT_POLL_INTERVAL_MS]);
    }
    this.pollGroups.set(pollGroup, normalized);
    return normalized;
  }
}

/** Handlers for /api/eng/* (arrow functions keep their binding for the router). */
export class EngController {
  private readonly store = new EngStore();
  /** Shared so browses of one connection serialise across HTTP requests. */
  private readonly browsePort = new WinccoaOpcUaBrowsePort();

  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'eng', store: this.store.path() });
  };

  // --- roles (Application Security) -----------------------------------------

  /**
   * GET /api/eng/roles -> { roles } — the studio roles granted to the session
   * user, evaluated with the shared app-security rules (unassigned = open).
   */
  public roles = async (req: Request, res: Response): Promise<void> => {
    const declared = ['view', 'edit-model', 'manage-devices', 'checkin'];
    try {
      const [assign, who] = await Promise.all([roleAssignments('eng-studio'), identityOf(req)]);
      const granted = declared.filter((role) => roleGranted(assign, role, who));
      res.status(200).json({ ok: true, roles: granted });
    } catch (error) {
      // Never lock the UI out on a directory failure: open roles + a warning.
      console.warn('engController.roles:', describeError(error));
      res.status(200).json({ ok: true, roles: declared, warning: describeError(error) });
    }
  };

  // --- devices ---------------------------------------------------------------

  public listDevices = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, devices: this.store.listDevices<Device>() });
  };

  /** POST /api/eng/devices  body { devices } — replace the device registry. */
  public saveDevices = (req: Request, res: Response): void => {
    const devices = (req.body ?? {}).devices as Device[] | undefined;
    if (!Array.isArray(devices)) {
      res.status(400).json({ ok: false, error: 'devices[] is required' });
      return;
    }
    this.store.saveDevices(devices);
    res.status(200).json({ ok: true, devices });
  };

  // --- address books ---------------------------------------------------------

  /**
   * Books are stored qualified. ACCESS overrides are applied FIRST, then the role
   * rules — several structural rules match on the access mode, so qualifying
   * before fixing the access would classify from a value the operator corrected.
   */
  private qualified(book: AddressBook): AddressBook {
    const access = this.store.readAccess(book.id) as Record<string, TagAccess>;
    const entries = withAccess(book.entries, access);
    const manual = this.store.readRoles(book.id) as Record<string, SignalRole>;
    const assignments = classifyEntries(entries, DEFAULT_ROLE_RULES, manual);
    // `asEngWarnings` tolerates the plain strings of books stored BEFORE the
    // structured warnings, so an existing store keeps loading (see core warnings.ts).
    return { ...book, entries: withRoles(entries, assignments), warnings: asEngWarnings(book.warnings) };
  }

  public listBooks = (_req: Request, res: Response): void => {
    const books = this.store
      .listBookIds()
      .map((id) => this.store.readBook<AddressBook>(id))
      .filter((book): book is AddressBook => book !== null)
      .map((book) => this.qualified(book));
    res.status(200).json({ ok: true, books });
  };

  public getBook = (req: Request, res: Response): void => {
    const book = this.store.readBook<AddressBook>(String(req.params['id']));
    res.status(200).json({ ok: true, book: book === null ? null : this.qualified(book) });
  };

  /**
   * POST /api/eng/books/:id/refresh
   *
   * Re-read the book's SOURCE when that is possible, then re-qualify:
   *  - `opcua-browse` with replayable `provenance.browse` → **re-browse the live
   *    server** with the very same parameters, and return the delta;
   *  - anything else (file-based, AI, manual) → re-run the role rules only. A file
   *    book is regenerated by re-ingesting its source (`/books/ingest`), because
   *    the server does not keep the uploaded document.
   *
   * The delta is the point of a refresh: `removed` entries may still be referenced
   * by a workspace, and silently swapping the catalog under a model is how a
   * project ends up with addresses pointing at nodes that no longer exist.
   */
  public refreshBook = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params['id']);
    const previous = this.store.readBook<AddressBook>(id);
    if (previous === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    const source = previous.provenance.browse;
    if (previous.provenance.kind !== 'opcua-browse' || source === undefined) {
      const qualified = this.qualified(previous);
      this.store.saveBook(qualified);
      res.status(200).json({
        ok: true,
        book: qualified,
        rebrowsed: false,
        note:
          previous.provenance.kind === 'opcua-browse'
            ? 'Carnet parcouru avant l’enregistrement des paramètres de parcours : relancer un parcours pour le rendre rafraîchissable.'
            : 'Source hors ligne : seules les règles de qualification ont été rejouées. Ré-ingérer le fichier source pour régénérer le catalogue.'
      });
      return;
    }
    try {
      const fresh = await buildBookFromOpcUaBrowse(this.browsePort, {
        ...source,
        bookId: previous.id,
        name: previous.name,
        driverNumber: previous.interface?.driverNumber
      });
      const delta = diffBooks(previous, fresh);
      const qualified = this.qualified(this.withRefreshWarnings(fresh, delta));
      this.store.saveBook(qualified);
      res.status(200).json({ ok: true, book: qualified, rebrowsed: true, delta: this.summariseDelta(delta) });
    } catch (error) {
      // A failed re-browse must NOT destroy the stored catalog.
      res.status(502).json({ ok: false, error: describeError(error), book: this.qualified(previous) });
    }
  };

  /** Paths of a delta (the full entries would bloat the response). */
  private summariseDelta(delta: BookDiff): { added: string[]; removed: string[]; changed: string[] } {
    return {
      added: delta.added.map((e) => e.path),
      removed: delta.removed.map((e) => e.path),
      changed: delta.changed.map((c) => c.after.path)
    };
  }

  /** Surface a destructive refresh in the book itself, where the operator looks. */
  private withRefreshWarnings(book: AddressBook, delta: BookDiff): AddressBook {
    return { ...book, warnings: [...refreshWarnings(delta), ...book.warnings] };
  }

  // --- online OPC UA browse ---------------------------------------------------

  /** GET /api/eng/connections — the project's OPC UA connections, browsable. */
  public connections = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ ok: true, connections: await listOpcUaConnections() });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/eng/books/browse
   * body { bookId, connection, name?, rootNodeId?, maxDepth?, maxEntries?, maxRequests?, driverNumber? }
   *
   * Walk a live OPC UA server into an address book and store it. Replaces a book
   * of the same id (that is what "re-browse" means), and returns the delta when
   * one existed — same contract as `/books/:id/refresh`.
   */
  public browseBook = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      bookId?: string;
      connection?: string;
      name?: string;
      rootNodeId?: string;
      maxDepth?: number;
      maxEntries?: number;
      maxRequests?: number;
      driverNumber?: number;
    };
    if (!body.bookId || !body.connection) {
      res.status(400).json({ ok: false, error: 'bookId and connection are required' });
      return;
    }
    const previous = this.store.readBook<AddressBook>(body.bookId);
    try {
      const fresh = await buildBookFromOpcUaBrowse(this.browsePort, {
        bookId: body.bookId,
        connection: body.connection,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.rootNodeId === undefined ? {} : { rootNodeId: body.rootNodeId }),
        ...(body.maxDepth === undefined ? {} : { maxDepth: body.maxDepth }),
        ...(body.maxEntries === undefined ? {} : { maxEntries: body.maxEntries }),
        ...(body.maxRequests === undefined ? {} : { maxRequests: body.maxRequests }),
        ...(body.driverNumber === undefined ? {} : { driverNumber: body.driverNumber })
      });
      const delta = previous === null ? null : diffBooks(previous, fresh);
      const qualified = this.qualified(delta === null ? fresh : this.withRefreshWarnings(fresh, delta));
      this.store.saveBook(qualified);
      res.status(200).json({
        ok: true,
        book: qualified,
        rebrowsed: true,
        ...(delta === null ? {} : { delta: this.summariseDelta(delta) })
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: describeError(error) });
    }
  };

  /**
   * POST /api/eng/books/:id/access  body { access: {path: 'r'|'w'|'rw'} }
   *
   * Manual ACCESS overrides. This is what makes a browse without `AccessLevel`
   * usable: the operator marks the writable signals, the override counts as
   * evidence (`accessSource: 'manual'`) and the generated address direction follows.
   * An empty string clears an override.
   */
  public saveBookAccess = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const access = (req.body ?? {}).access as Record<string, string> | undefined;
    if (access === undefined || typeof access !== 'object') {
      res.status(400).json({ ok: false, error: "access {path: 'r'|'w'|'rw'} is required" });
      return;
    }
    const invalid = Object.entries(access).filter(([, mode]) => !['r', 'w', 'rw', ''].includes(mode));
    if (invalid.length > 0) {
      res.status(400).json({ ok: false, error: `invalid access mode(s): ${invalid.map(([p, m]) => `${p}='${m}'`).join(', ')}` });
      return;
    }
    const book = this.store.readBook<AddressBook>(id);
    if (book === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    this.store.saveAccess(id, access);
    const qualified = this.qualified(book);
    this.store.saveBook(qualified);
    res.status(200).json({ ok: true, book: qualified });
  };

  /** POST /api/eng/books/:id/roles  body { roles } — manual role overrides. */
  public saveBookRoles = (req: Request, res: Response): void => {
    const id = String(req.params['id']);
    const roles = (req.body ?? {}).roles as Record<string, string> | undefined;
    if (roles === undefined || typeof roles !== 'object') {
      res.status(400).json({ ok: false, error: 'roles {path: role} is required' });
      return;
    }
    const book = this.store.readBook<AddressBook>(id);
    if (book === null) {
      res.status(404).json({ ok: false, error: 'unknown book' });
      return;
    }
    this.store.saveRoles(id, roles);
    const qualified = this.qualified(book);
    this.store.saveBook(qualified);
    res.status(200).json({ ok: true, book: qualified });
  };

  /**
   * POST /api/eng/books/ingest
   * body { bookId, name?, format, interface?, documents? | text? | xml? }
   *
   * Builds an address book with the core's file generators and stores it:
   *   simaticml → documents[{fileName,xml}]   (TIA Openness export bundle)
   *   xvm       → xml                          (Control Expert XVM/XSY)
   *   csv       → text                         (Control Expert variables export)
   *   nodeset   → xml                          (OPC UA NodeSet2 / companion spec)
   */
  public ingestBook = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      bookId?: string;
      name?: string;
      format?: 'simaticml' | 'xvm' | 'csv' | 'nodeset';
      interface?: AddressBook['interface'];
      documents?: { fileName: string; xml: string }[];
      xml?: string;
      text?: string;
      file?: string;
    };
    if (!body.bookId || !body.format) {
      res.status(400).json({ ok: false, error: 'bookId and format (simaticml | xvm | csv | nodeset) are required' });
      return;
    }
    try {
      let book: AddressBook;
      const provenance = { file: body.file, generatedAt: new Date().toISOString() };
      switch (body.format) {
        case 'simaticml': {
          if (!Array.isArray(body.documents) || body.documents.length === 0) {
            throw new Error('documents[{fileName,xml}] is required for the simaticml format');
          }
          book = buildBookFromSimaticMl({
            bookId: body.bookId,
            name: body.name,
            documents: body.documents,
            provenance,
            interface: body.interface
          });
          break;
        }
        case 'xvm': {
          if (!body.xml) throw new Error('xml is required for the xvm format');
          book = buildBookFromXvm({ bookId: body.bookId, name: body.name, xml: body.xml, provenance, interface: body.interface });
          break;
        }
        case 'csv': {
          if (!body.text) throw new Error('text is required for the csv format');
          book = buildBookFromSchneiderExport({
            bookId: body.bookId,
            name: body.name,
            text: body.text,
            provenance,
            interface: body.interface
          });
          break;
        }
        case 'nodeset': {
          if (!body.xml) throw new Error('xml is required for the nodeset format');
          // A NodeSet is a MODEL: it is always a template catalog (file-local
          // namespace indices), so `interface` is deliberately not forwarded —
          // see the generator's header.
          book = buildBookFromNodeSet({ bookId: body.bookId, name: body.name, xml: body.xml, file: body.file });
          break;
        }
        default: {
          throw new Error(`unsupported format '${String(body.format)}'`);
        }
      }
      const qualified = this.qualified(book);
      this.store.saveBook(qualified);
      res.status(200).json({ ok: true, book: qualified });
    } catch (error) {
      res.status(400).json({ ok: false, error: describeError(error) });
    }
  };

  // --- workspace -------------------------------------------------------------

  /** GET /api/eng/workspace?name= — the working copy (default: the first one). */
  public getWorkspace = (req: Request, res: Response): void => {
    const requested = req.query['name'] === undefined ? undefined : String(req.query['name']);
    const name = requested ?? this.store.listWorkspaceNames()[0];
    const workspace =
      name === undefined
        ? null
        : this.store.readWorkspace<Workspace>(name);
    res.status(200).json({
      ok: true,
      workspace: workspace ?? { name: requested ?? 'default', types: [], dps: [], configs: {}, baseline: {} }
    });
  };

  public saveWorkspace = (req: Request, res: Response): void => {
    const workspace = (req.body ?? {}).workspace as Workspace | undefined;
    if (!workspace || typeof workspace.name !== 'string') {
      res.status(400).json({ ok: false, error: 'workspace {name,…} is required' });
      return;
    }
    this.store.saveWorkspace(workspace);
    res.status(200).json({ ok: true });
  };

  /**
   * POST /api/eng/checkout  body { name, types?: string[], dpes?: string[] }
   * Read the live project and return a workspace pre-loaded with it, plus the
   * BASELINE fingerprints — that is what makes conflict detection possible.
   */
  public checkout = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { name?: string; types?: string[]; dpes?: string[] };
    try {
      const snapshot = await this.readSnapshot(body.types, body.dpes);
      const workspace: Workspace = {
        name: body.name ?? 'default',
        types: snapshot.types,
        dps: snapshot.dps,
        configs: snapshot.configs,
        baseline: baselineOf(snapshot),
        checkedOutAt: new Date().toISOString(),
        checkedOutBy: (await identityOf(req)).username || undefined
      };
      this.store.saveWorkspace(workspace);
      res.status(200).json({ ok: true, workspace });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  // --- live snapshot + check-in ----------------------------------------------

  /**
   * POST /api/eng/live  body { types?: string[], dpes?: string[] }
   * (GET is accepted too, types/DPs only.) `dpes` requests the CONFIG read-back
   * for those DPEs — the caller passes the union of its workspace config keys and
   * its baseline `cfg:` keys, so a config DELETED from the workspace is still seen
   * live and can be planned for removal.
   */
  public live = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { types?: string[]; dpes?: string[] };
    try {
      const snapshot = await this.readSnapshot(body.types, body.dpes);
      res.status(200).json({ ok: true, snapshot });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/checkin  body { plan, dryRun } */
  public checkin = async (req: Request, res: Response): Promise<void> => {
    const { plan, dryRun } = (req.body ?? {}) as { plan?: EngPlan; dryRun?: boolean };
    if (!plan || !Array.isArray(plan.items)) {
      res.status(400).json({ ok: false, error: 'a plan with items[] is required' });
      return;
    }
    try {
      const port = new WinccoaEngPort(this.store.listDevices<Device>());
      // Config deletes need the live configs to know which families to retire.
      const deletes = plan.items.filter((item) => item.kind === 'config' && item.op === 'delete').map((item) => item.name);
      const previousConfigs = deletes.length > 0 ? (await this.readConfigs(deletes)) : {};
      const report = await applyPlan(plan, port, { dryRun: dryRun === true, previousConfigs });
      res.status(200).json(report);
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/plan  body { workspace } -> the diff against the live project. */
  public plan = async (req: Request, res: Response): Promise<void> => {
    const workspace = (req.body ?? {}).workspace as Workspace | undefined;
    if (!workspace) {
      res.status(400).json({ ok: false, error: 'workspace is required' });
      return;
    }
    try {
      // The read scope comes from the core (same helper the UI uses) so a config
      // deleted from the workspace is still read live and can be planned away.
      const scope = liveScopeOf(workspace);
      const snapshot = await this.readSnapshot(scope.types, scope.dpes);
      res.status(200).json({ ok: true, plan: diffWorkspace(workspace, snapshot) });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  /** POST /api/eng/test-read  body { dpes } — current values (pre-check-in). */
  public testRead = async (req: Request, res: Response): Promise<void> => {
    const dpes = ((req.body ?? {}) as { dpes?: string[] }).dpes ?? [];
    if (dpes.length === 0) {
      res.status(200).json({ ok: true, results: [] });
      return;
    }
    try {
      const raw = await win().dpGet(dpes.map((dpe) => `${dpe}:_original.._value`));
      const values = Array.isArray(raw) ? raw : [raw];
      res.status(200).json({
        ok: true,
        results: dpes.map((dpe, index) => ({ dpe, value: values[index] ?? null, ok: values[index] != null }))
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: describeError(error) });
    }
  };

  // --- live reading helpers --------------------------------------------------

  /**
   * Read the live project into the core's snapshot shape.
   *
   * @param typeNames restrict to these DP types (default: every non-internal type)
   * @param dpes      DPEs whose CONFIGS must be read back (default: none — types
   *                  and datapoints only, which is all the type/DP diff needs)
   */
  private async readSnapshot(typeNames?: string[], dpes?: string[]): Promise<LiveSnapshot> {
    const w = win();
    const wanted = typeNames && typeNames.length > 0
      ? typeNames
      : ((w.dpTypes('*') ?? []) as string[]).map(String).filter((name) => name.length > 0 && !name.startsWith('_'));
    const types: LiveSnapshot['types'] = [];
    const dps: LiveSnapshot['dps'] = [];
    for (const typeName of wanted) {
      try {
        types.push({ typeName, structure: structureOf(w.dpTypeGet(typeName)) });
      } catch {
        continue; // unknown type (e.g. a workspace type not created yet)
      }
      for (const dp of (w.dpNames('*', typeName) ?? []) as string[]) {
        dps.push({ dpName: String(dp).replace(/\.$/, ''), dpType: typeName });
      }
    }
    const configs = dpes && dpes.length > 0 ? await this.readConfigs(dpes) : {};
    return { types, dps, configs };
  }

  /**
   * Read the configs of the given DPEs, batched. The raw → {@link DpeConfigs}
   * mapping lives in the core (`configsFromRaw`), unit-tested without a runtime;
   * a DPE with no config at all is simply absent from the result.
   */
  private async readConfigs(dpes: string[]): Promise<Record<string, DpeConfigs>> {
    const out: Record<string, DpeConfigs> = {};
    const attrsPerDpe = configReadPaths('x').length;
    for (let start = 0; start < dpes.length; start += READ_BATCH) {
      const batch = dpes.slice(start, start + READ_BATCH);
      const paths = batch.flatMap((dpe) => configReadPaths(dpe));
      let values: unknown[];
      try {
        const raw = await win().dpGet(paths);
        values = Array.isArray(raw) ? raw : [raw];
      } catch (error) {
        // A batch can fail as a whole (one absent DPE) — fall back to per-DPE.
        console.warn('engController.readConfigs: batch failed, retrying per DPE:', describeError(error));
        for (const dpe of batch) {
          try {
            const raw = await win().dpGet(configReadPaths(dpe));
            const configs = configsFromRaw(Array.isArray(raw) ? raw : [raw]);
            if (configs) out[dpe] = configs;
          } catch {
            continue; // DPE does not exist yet (a workspace creation) — no config
          }
        }
        continue;
      }
      for (const [index, dpe] of batch.entries()) {
        const slice = values.slice(index * attrsPerDpe, (index + 1) * attrsPerDpe);
        const configs = configsFromRaw(slice);
        if (configs) out[dpe] = configs;
      }
    }
    return out;
  }
}
