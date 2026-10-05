// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engineering Studio — standalone WinCC OA WebUI page (`/eng-studio`).
 *
 * A device-first, check-in/check-out studio to model DP types, datapoints and
 * their configs (address / alarm / archive / range) from communicating
 * equipment. Four panels:
 *   1. Devices                  — the equipment, their connection and driver;
 *   2. Catalogs (address books) — the catalogs as first-class objects: create one
 *                                 from a file or an online walk WITHOUT any
 *                                 equipment, qualify it, bind it to N equipments;
 *   3. Model                    — the address-book browser (pick → resolved
 *                                 rows) and the signal grid (mass edit);
 *   4. Control (check-in)       — the diff vs the live project, dry-run, apply.
 *
 * Look & feel: the **Siemens iX design system**, like every other page of the
 * suite — `IXCoreStyles` in the shadow root, `wui-content-header`, `ix-tabs`,
 * `ix-button`, `ix-input`, `ix-select`, `ix-message-bar`, `ix-chip`. The iX
 * custom elements are registered once by the app shell; the offline demo
 * registers them itself (`demo/main.ts`).
 *
 * Decoupling: all I/O goes through an injected {@link EngGateway} —
 * {@link HttpEngGateway} in the shell, {@link DemoEngGateway} for the offline demo
 * / docs / screenshots. So the page still renders and is screenshotted with NO
 * WinCC OA runtime; what it now needs is the iX design system, not a backend.
 */
import {
  CONN_STATE,
  SIGNAL_ROLES,
  SIGNAL_ROLE_LABEL,
  classifyEntry,
  forgetInWorkspace,
  statesUnreadable,
  withDeviceStates,
  diffWorkspace,
  filterEntries,
  PROTOCOLS,
  PROTOCOL_PARAMS,
  autoBindStructure,
  blockingProblems,
  deviceIdFrom,
  draftFromDevice,
  emptyDraft,
  formatStructureOutline,
  bindingRef,
  parseBindingRef,
  generateModelFromBook,
  instanceTargets,
  liveScopeOf,
  mergeProposal,
  modelInstances,
  dpTypeStructureAsModel,
  modelSources,
  modelSyncState,
  mirrorIntoStructure,
  removeSourceFromModel,
  sanitizeSegment,
  modelStatus,
  tallyInstances,
  parseStructureOutline,
  roleCounts,
  validateDevice,
  structureLeaves,
  templateIdFrom,
  isS7PlusOnline,
  isReadingDirection,
  connectionNameOf,
  defaultLeafPolicy,
  DpAddressDirection,
  S7PLUS_ONLINE_STATION,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type BookEntry,
  type Device,
  type DeviceDraft,
  type DeviceParamSpec,
  type DpTypeStructure,
  type EngPlan,
  type PlanItem,
  type EngWarning,
  type InstanceStatus,
  type LeafPolicy,
  type ModelInstance,
  type ModelMapping,
  type ModelPolicy,
  type ProtocolKind,
  type StructureBindings,
  type ModelTemplate,
  type BrowseProgress,
  type OpcUaBrowseNode,
  type S7PlusBrowseNode,
  type TagAccess,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept-winccoa/wui-eng-core';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { engStudioStyles } from './eng-studio/eng-styles.js';
import { DemoEngGateway } from './eng-studio/data/demo-gateway.js';
import { HttpEngGateway } from './eng-studio/data/http-gateway.js';
import type {
  BookDelta,
  EngConfigOptions,
  EngConnection,
  EngDriver,
  EngGateway,
  EngRole,
  EngS7PlusConnection,
  EngS7PlusStation,
  IngestRequest,
  LiveScope,
  S7InventoryResult,
  S7PlusManagerHealth
} from './eng-studio/data/gateway.js';
import './eng-studio/ui/eng-books.js';
import './eng-studio/ui/eng-structure-tree.js';
import type { BookBrowseDetail, BookIngestDetail, BookS7PlusBrowseDetail } from './eng-studio/ui/eng-book-form.js';
import { driverMismatchHint, offerableDrivers, renderDriverSelect } from './eng-studio/ui/eng-driver-select.js';
import { renderConnectionSelect, unknownConnectionHint } from './eng-studio/ui/eng-connection-select.js';
import type { DpPickRequest, PolicyChangeDetail, StructureBindDetail, StructureChangeDetail } from './eng-studio/ui/eng-structure-tree.js';
import {
  MSG,
  PARAM_LABEL,
  PARAM_OPTION_LABEL,
  ROLE_LABEL,
  fmt,
  resolveLang,
  t,
  warnText,
  type Lang,
  type Ml
} from './eng-studio/i18n.js';

type Panel = 'devices' | 'books' | 'model' | 'instances';

/** Tab order of the top bar — the index `ix-tabs` reports and selects. */
const PANEL_ORDER: Panel[] = ['devices', 'books', 'model', 'instances'];

/** The role gating every model edit — qualifying a signal included. */
const EDIT_MODEL: EngRole = 'edit-model';

/**
 * How often the connection state is re-read (ms).
 *
 * A connection state is not a process value: it changes when a link drops or a driver is
 * restarted — events measured in seconds. 5 s keeps a lamp honest without turning an
 * engineering screen into a poller, and the request carries the live fields only
 * (`GET /devices/state`, a handful of numbers).
 */
const STATE_POLL_MS = 5000;

/** Consecutive failed refreshes after which the lamps go grey (`statesUnreadable`). */
const STATE_POLL_TOLERANCE = 3;

export class WuiEngStudio extends LitElement {
  static override readonly styles = engStudioStyles;

  /** Injected gateway. Defaults to HTTP in the shell; the demo entry sets a DemoEngGateway. */
  gateway: EngGateway = new HttpEngGateway();

  /** Default panel: DEVICES — the studio is device-first, and an empty project starts by declaring one. */
  @state() private panel: Panel = 'devices';
  @state() private devices: Device[] = [];
  @state() private selectedDeviceId: string | null = null;
  /** Every address book (registry); a book may be shared by several devices. */
  @state() private books: AddressBook[] = [];
  /**
   * The active catalog — the one the signal table shows and the one the Model panel
   * composes from. NOT tied to the selected equipment: a model is authored against a
   * catalog, and which equipments it serves is a later question.
   */
  @state() private selectedBookId: string | null = null;
  /** Filter for the signal table shown in the Devices panel's address book. */
  @state() private signalFilter = '';
  /** Role filter of the signal table ('' = all). */
  @state() private roleFilter: SignalRole | '' = '';
  /** Signal paths checked for a bulk role assignment. */
  @state() private checkedSignals = new Set<string>();
  /**
   * Entry path whose role cell is being edited (one at a time — see
   * `renderRoleCell`), `null` when none.
   */
  @state() private editingRole: string | null = null;
  /** Model-generation form (Model panel). */
  /**
   * The DP TYPE the model targets — which is NOT the same thing as the model's name.
   *
   * They were one field while every model created its own type. A model built ON an existing
   * type (a project engineered in PARA before the studio) must keep pointing AT that type:
   * deriving the type from the model's name would have generated a second one beside it and
   * left the datapoints of the first unconfigured.
   */
  @state() private genTypeName = '';
  /** The model's own name — a label, free of the identifier rules the type obeys. */
  @state() private genModelName = '';
  @state() private genEquipments = '';
  /**
   * Equipment the generation targets, '' → the one selected in the Devices panel.
   * Explicit so a model composed from a shared catalog can be applied to any
   * equipment without leaving the Model panel.
   */
  @state() private genTargetId = '';
  /** The project's reusable models, and the one currently loaded ('' = none). */
  @state() private models: ModelTemplate[] = [];
  @state() private genModelId = '';
  /** The selected model's description — free text, stored with it. */
  @state() private genDescription = '';
  /**
   * The model being CREATED (name + description), before it exists.
   *
   * A step of its own rather than a row in the list: a model is created empty and stored
   * at once, so everything chosen afterwards (its catalogs, which of them it mirrors, its
   * mapping) has a record to be saved into.
   */
  @state() private modelDraft: { name: string; description: string; fromType?: string } | null = null;
  /**
   * Which source catalogs SHAPE the model — the ones whose paths are mirrored into its
   * structure. Per catalog, because a model may mirror one export and merely map onto
   * another (see `rebuildMirroredStructure`).
   */
  /**
   * Is the selected model OPEN FOR EDITING?
   *
   * A model is read-only until "Edit" is pressed, and every change then lands in page
   * state until "Save" — so leaving the screen, or "Cancel", cannot half-modify a stored
   * house standard. Creating one (`modelDraft`) is editing by definition.
   */
  @state() private modelEditing = false;
  /** Memo of {@link sourceEntries} — see it for why (a render-time N× cost). */
  private entryCacheKey = '';
  private entryCache: BookEntry[] = [];
  /** The datapoint search opened by a leaf's magnifier ({@link renderDpPicker}). */
  @state() private dpPick:
    | { leaf: string; field: 'alarmClass' | 'archiveGroup'; range?: number; pattern: string; results: string[]; truncated: boolean }
    | null = null;
  /** The project's DP type names — a new model may start from one of them. */
  @state() private dpTypes: string[] = [];
  /** The project's alarm classes and archive groups, offered per leaf. */
  @state() private configOptions: EngConfigOptions = { alarmClasses: [], archiveGroups: [], subscriptions: [], pollGroups: [] };
  /** Which model the Instances tab is showing (''= the first one). */
  @state() private instanceModelType = '';
  /**
   * Re-create ARMED for this type name — a first click asks, a second one does it.
   *
   * Two clicks rather than a modal for the same reason the device delete does it: this is
   * the one operation that DROPS datapoints (and their archived values) instead of amending
   * them, so it must be impossible to trigger by reflex.
   */
  @state() private recreateArmed = '';
  /** Which model row (by type name) has its instance form open, in the Instances tab. */
  @state() private instanceFormType: string | null = null;
  /** Warnings of the last generation, shown under the form. */
  @state() private genWarnings: EngWarning[] = [];
  /** Authored structure, as an editable outline (see the core's structure.ts). */
  @state() private genOutline = '';
  /** Parse errors of the outline (shown next to it, never thrown). */
  @state() private genOutlineErrors: EngWarning[] = [];
  /** Target leaf path → book entry path. */
  @state() private genBindings: StructureBindings = {};
  /**
   * DEPLOYMENT POLICY being composed: per mapped leaf, whether to alarm (and in
   * which class), whether to archive (and in which group), and an optional range.
   *
   * Held beside the bindings and SAVED WITH THE MODEL, because that is the whole
   * "define it once" point: the structure says what the type is, the bindings
   * where each leaf reads from, and this how each leaf is configured — then every
   * instance (another connection, another equipment) replays the same decisions.
   * An absent leaf key means "the default" (see the core's `defaultLeafPolicy`),
   * never "off".
   */
  @state() private genPolicy: ModelPolicy = {};
  /** Models expanded in the Instances tree (by type name). */
  /**
   * ADDITIONAL source catalogs of the model being composed (beside `selectedBookId`,
   * the primary). A model may read several — see `renderCatalogSources`.
   */
  @state() private extraBookIds = new Set<string>();
  /** Leaves auto-binding could not decide (several equal candidates). */
  @state() private genAmbiguous: { leaf: string; candidates: string[] }[] = [];
  @state() private workspace: Workspace | null = null;
  @state() private live: LiveSnapshot | null = null;
  @state() private plan: EngPlan | null = null;
  @state() private report: ApplyReport | null = null;
  @state() private roles = new Set<EngRole>();
  @state() private busy = false;
  @state() private notice = '';
  /**
   * UI language. NOT named `lang`: that would shadow the native `HTMLElement.lang`
   * property, and Lit does not observe it anyway — the element's `lang` attribute is
   * read once at connect time instead (see `connectedCallback`). The pure core's
   * messages stay English — see i18n.ts, "SCOPE".
   */
  @state() private uiLang: Lang = resolveLang(null);
  /** Live OPC UA connections available for an online browse. */
  @state() private connections: EngConnection[] = [];
  /**
   * The project's S7Plus connections and whether their browse manager answers.
   * Loaded like the OPC UA connections — best-effort: a project without the S7Plus
   * driver simply does not offer the generator, which is not an error.
   */
  @state() private s7plusConnections: EngS7PlusConnection[] = [];
  @state() private s7plusManager: S7PlusManagerHealth | undefined;
  /** The project's drivers, offered as an equipment's `driverNumber`. */
  @state() private drivers: EngDriver[] = [];
  /** Catalogues panel: the creation form is open (the page owns its visibility). */
  @state() private bookFormOpen = false;
  /** Refusal of the last catalogue creation, shown inside its form. */
  @state() private bookFormError = '';
  /** Progress of the walk in flight (null when none) — see `onWalkBook`. */
  @state() private walking: BrowseProgress | null = null;
  /**
   * The classic-S7 online check: whether the reader is deployed, what it last
   * said, and whether a read is in flight.
   *
   * The result is held HERE and not stored with the catalog on purpose: a catalog
   * is a reading of the STEP 7 project and an inventory is a reading of a machine
   * at one moment. Persisting the second beside the first would turn a transient
   * disagreement into a property of the export.
   */
  /** The project's classic-S7 connections, offered by the device form. */
  @state() private s7Connections: EngConnection[] = [];
  @state() private s7BrowseAvailable = false;
  @state() private s7Inventory: (S7InventoryResult & { bookId: string }) | null = null;
  @state() private s7InventoryBusy = false;
  /**
   * Set by "Stop" and read by the walk's progress callback, which THROWS to unwind
   * the walker. A flag rather than an AbortSignal because the seam is the core's
   * `onProgress` hook: it is called on every request, so it is the natural — and only
   * — place a walk can be interrupted.
   */
  private walkCancelled = false;
  /** Online-browse form (Devices panel). */
  @state() private browseConnection = '';
  @state() private browseRoot = '';
  @state() private browseBookId = '';
  /** Delta of the last source re-read — the reason a refresh is not a no-op. */
  @state() private bookDelta: BookDelta | null = null;
  /**
   * Device form: the draft being edited, `null` when the form is closed.
   * `deviceFormId` is the id being EDITED ('' for a creation) — kept apart from the
   * draft so a rename never re-derives the id (books reference a device by id).
   */
  @state() private deviceDraft: DeviceDraft | null = null;
  @state() private deviceFormId = '';
  /** Validation problems of the draft, re-computed on every edit. */
  @state() private deviceProblems: EngWarning[] = [];
  /**
   * Delete armed by a first click: forgetting an equipment is not undoable from
   * the UI, so the button asks twice instead of opening a modal.
   */
  @state() private deviceDeleteArmed = false;

  /** Timer of the connection-state refresh (null = not polling). */
  private statePoll: ReturnType<typeof setInterval> | null = null;
  /** Consecutive failed refreshes — see {@link refreshStates}. */
  private statePollFailures = 0;
  /** Bound so the same reference can be removed on disconnect. */
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.refreshStates();
  };

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    // The shell sets `lang` on the element; the demo and the screenshot harness use
    // `?lang=`; both fall back to <html lang> then the browser (see resolveLang).
    this.uiLang = resolveLang(this.getAttribute('lang'));
    await this.load();
    this.startStatePolling();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopStatePolling();
  }

  /**
   * Keep the connection LEDs LIVE.
   *
   * A connection state is read, so it is only as current as its last read: without this
   * the lamps froze on whatever the page loaded with — a green LED next to a machine
   * that had dropped an hour ago. It is a timer rather than a datapoint subscription on
   * purpose: this page's contract is to depend on `lit` alone (see NOTES, "the
   * decoupling contract"), so it cannot open a `dpConnect` through the suite's shared
   * libraries and still run in the offline demo and the screenshot pipeline.
   */
  private startStatePolling(): void {
    if (this.statePoll !== null) return;
    this.statePoll = setInterval(() => void this.refreshStates(), STATE_POLL_MS);
    // Coming back to a screen left open for hours must not show a stale lamp for
    // another poll interval.
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private stopStatePolling(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.statePoll === null) return;
    clearInterval(this.statePoll);
    this.statePoll = null;
  }

  /**
   * Re-read the states and merge them into the devices — the LIVE fields only, so a
   * refresh can never overwrite an equipment the operator is editing.
   *
   * Skipped while the tab is hidden (an engineering screen stays open for days; polling
   * one nobody is looking at is pure cost) and while an action is running, so a refresh
   * never lands in the middle of a check-in.
   *
   * A failure is tolerated for a few rounds — a reload, a brief network hiccup — and
   * then the lamps go GREY: a frozen green LED, still claiming a machine answers long
   * after the page stopped being able to ask, is the one outcome worse than no LED.
   */
  private async refreshStates(): Promise<void> {
    if (this.busy || this.devices.length === 0) return;
    if (document.visibilityState === 'hidden') return;
    try {
      const states = await this.gateway.deviceStates();
      this.devices = withDeviceStates(this.devices, states);
      this.statePollFailures = 0;
    } catch (error) {
      this.statePollFailures += 1;
      if (this.statePollFailures === STATE_POLL_TOLERANCE) {
        console.warn('eng-studio: the connection-state refresh keeps failing —', error);
        this.devices = statesUnreadable(this.devices);
      }
    }
  }

  /** Force the demo gateway (used by the standalone demo entry). */
  useDemo(): void {
    this.gateway = new DemoEngGateway();
    void this.load();
  }

  /** Public: select an equipment by id (used by the demo/screenshot harness). */
  selectDeviceById(id: string): void {
    if (this.devices.some((d) => d.id === id)) this.selectDevice(id);
  }

  /** Public: activate one of the selected equipment's books by id. */
  selectBookById(id: string): void {
    if (this.books.some((b) => b.id === id)) this.selectBook(id);
  }

  /** Public: filter the signal table by role ('' = all) — demo/screenshot harness. */
  filterByRole(role: SignalRole | ''): void {
    this.roleFilter = role;
  }

  /** Public: browse a connection into a book (demo/screenshot harness). */
  async browseForDemo(connection: string, bookId = ''): Promise<void> {
    this.browseConnection = connection;
    this.browseBookId = bookId;
    await this.onBrowseConnection();
  }

  /** Public: re-read the selected book's source (demo/screenshot harness). */
  async refreshForDemo(): Promise<void> {
    await this.onRefreshBook();
  }

  /**
   * Public: author a structure in the Model tab (demo/screenshot harness).
   * With no outline it mirrors the selected catalog; `outline` overrides it to show a
   * house-standard structure mapped onto a differently-shaped book.
   */
  customStructureForDemo(typeName: string, outline?: string): void {
    const book = this.activeBook();
    if (!book) return;
    // The detail column shows a MODEL: open one (and its editor) first, exactly as an
    // operator would, so the authored structure has somewhere to be shown.
    if (this.genModelId === '' && this.models[0] !== undefined) this.onLoadModel(this.models[0].id);
    this.modelEditing = true;
    this.genTypeName = typeName;
    if (outline === undefined) {
      this.onMirrorSource(book);
      return;
    }
    this.genOutline = outline;
    this.genOutlineErrors = parseStructureOutline(this.genOutline, typeName).errors;
    this.genBindings = {};
    this.onAutoBind(book);
  }

  /**
   * Public: open the CREATION form of a model (demo/screenshot harness).
   * Through `onNewModel`, so the form starts from the same blank state an operator gets
   * (no catalog inherited from whatever was selected before), then the fields are filled.
   */
  /** Public: pin per-leaf deployment decisions (demo/screenshot harness). */
  policyForDemo(policy: ModelPolicy): void {
    this.genPolicy = { ...this.genPolicy, ...policy };
  }

  modelFormForDemo(name = '', description = '', sources: { bookId: string; mirror?: boolean }[] = [], fromType = ''): void {
    this.panel = 'model';
    this.onNewModel();
    this.modelDraft = { name, description, ...(fromType === '' ? {} : { fromType }) };
    for (const source of sources) {
      this.toggleSourceBook(source.bookId);
      const book = this.books.find((candidate) => candidate.id === source.bookId);
      if (source.mirror === true && book !== undefined) this.onMirrorSource(book);
    }
  }

  /** Public: open one model's INSTANCE form in the Instances tab (demo/screenshot). */
  instanceFormForDemo(typeName: string, equipments = '', deviceId = ''): void {
    this.panel = 'instances';
    this.genEquipments = equipments;
    if (deviceId !== '') this.genTargetId = deviceId;
    this.openInstanceForm(typeName);
  }

  /**
   * Public: open the device form (demo/screenshot harness).
   * With no `deviceId` it opens a CREATION; `draft` then pre-fills the fields the
   * way typing would — through `patchDraft`, so the validation runs like it does
   * for an operator (the screenshot shows real problems, not staged ones).
   */
  deviceFormForDemo(deviceId?: string, draft?: Partial<DeviceDraft>): void {
    const device = deviceId === undefined ? undefined : this.devices.find((d) => d.id === deviceId);
    if (device) this.onEditDevice(device);
    else this.onAddDevice();
    if (draft) this.patchDraft(draft);
  }

  /**
   * Public: open the CATALOGUE creation form on the Catalogues panel
   * (demo/screenshot harness).
   */
  bookFormForDemo(): void {
    this.panel = 'books';
    this.openBookForm();
  }

  /**
   * Public: generate straight from the selected catalog (demo/screenshot harness).
   *
   * Mirrors the catalog rather than instantiating a stored model — that is the
   * "qualify → generate → diff" story the screenshots tell, in one call.
   */
  generateForDemo(typeName: string, equipments: string): void {
    const book = this.activeBook();
    if (!book) return;
    this.genTypeName = typeName;
    this.genEquipments = equipments;
    void this.runGeneration({ book, typeName });
  }

  /** Monotonic load token — only the latest load() writes state (demo swap race). */
  private loadToken = 0;

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    const gateway = this.gateway;
    this.busy = true;
    this.notice = '';
    try {
      const roles = await gateway.roles();
      const devices = await gateway.listDevices();
      const books = await gateway.listBooks();
      // Browsable connections and the driver list are nice-to-haves: never fail the
      // whole load on them — the forms degrade to free entry instead.
      const connections = await gateway.listConnections().catch(() => [] as EngConnection[]);
      const s7plusConnections = await gateway.listS7PlusConnections().catch(() => [] as EngS7PlusConnection[]);
      // Only asked when there is something to browse: probing a service no
      // connection needs would put a vRPC round-trip in every page load.
      const s7plusManager =
        s7plusConnections.length === 0 ? undefined : await gateway.s7plusHealth().catch(() => undefined);
      // Same rule for the classic-S7 reader: only asked when the project actually
      // declares an S7-300/400 equipment, so a project without one never pays a
      // vRPC round-trip for a manager it has no use for.
      const hasClassicS7 = devices.some((candidate) => candidate.protocol === 's7');
      const s7Browse = hasClassicS7 ? await gateway.s7BrowseHealth().catch(() => ({ reachable: false })) : { reachable: false };
      // Offered by the device form. Listed unconditionally — unlike the reader probe
      // above, this is what an operator needs precisely when the project has NO S7
      // equipment yet: it is how the first one is declared against a real connection.
      const s7Connections = await gateway.listS7Connections().catch(() => [] as EngConnection[]);
      const drivers = await gateway.listDrivers().catch(() => [] as EngDriver[]);
      // The project's alarm classes and archive groups — offered per leaf in the model
      // editor. Never fatal: an empty pair means "could not tell", and the fields then
      // accept free entry rather than blocking a deployment decision.
      const configOptions = await gateway
        .listConfigOptions()
        .catch(() => ({ alarmClasses: [], archiveGroups: [], subscriptions: [], pollGroups: [] }) as EngConfigOptions);
      // The project's OWN DP types: a model may be started from one that already exists,
      // which is the normal case on a project engineered in PARA before the studio.
      const dpTypes = await gateway.listDpTypes().catch(() => [] as string[]);
      const models = await gateway.listModels().catch(() => [] as ModelTemplate[]);
      const selectedDeviceId = this.selectedDeviceId ?? devices[0]?.id ?? null;
      const device = devices.find((d) => d.id === selectedDeviceId);
      const selectedBookId = this.selectedBookId ?? device?.bookIds[0] ?? null;
      const workspace = await gateway.getWorkspace();
      // The models are already read above, so the scope can include the types they target —
      // which is what makes an existing type and its datapoints visible on first paint.
      const scope = liveScopeOf(workspace);
      const live = await gateway.liveSnapshot({
        types: [...new Set([...scope.types, ...models.map((model) => model.typeName)])],
        dpes: scope.dpes
      });
      if (token !== this.loadToken) return; // superseded (e.g. by useDemo)
      this.roles = roles;
      this.devices = devices;
      this.books = books;
      this.connections = connections;
      this.s7plusConnections = s7plusConnections;
      this.s7plusManager = s7plusManager;
      this.s7Connections = s7Connections;
      this.s7BrowseAvailable = s7Browse.reachable;
      this.drivers = drivers;
      this.configOptions = configOptions;
      this.dpTypes = dpTypes;
      this.models = models;
      if (this.browseConnection === '') this.browseConnection = connections.find((c) => c.connected)?.name ?? '';
      this.selectedDeviceId = selectedDeviceId;
      this.selectedBookId = selectedBookId;
      this.workspace = workspace;
      this.live = live;
      this.recomputePlan();
    } catch (error) {
      if (token === this.loadToken) this.notice = this.tr(MSG.loadFailed, { error: (error as Error).message });
    } finally {
      if (token === this.loadToken) this.busy = false;
    }
  }

  /**
   * What the live read must cover: the workspace's own scope PLUS the DP types the models
   * target.
   *
   * A model that parameterises an existing type describes nothing in the workspace until it is
   * instantiated, so `liveScopeOf` alone never asked for that type — and the page then read
   * "no such type, no such datapoint": the model showed "not created" beside a type that
   * exists, and its instances were invisible. The models are part of what this screen is
   * about, so their types are part of what it has to read.
   */
  private liveScope(workspace: Workspace): LiveScope {
    const scope = liveScopeOf(workspace);
    const types = new Set([...scope.types, ...this.models.map((model) => model.typeName)]);
    return { types: [...types], dpes: scope.dpes };
  }

  private recomputePlan(): void {
    if (this.workspace && this.live) {
      this.plan = diffWorkspace(this.workspace, this.live);
    }
  }

  private can(role: EngRole): boolean {
    return this.roles.has(role);
  }

  /** Translated role label (the core's own labels stay French — see i18n.ts). */
  private roleLabel(role: SignalRole): string {
    const label = ROLE_LABEL[role];
    return label === undefined ? SIGNAL_ROLE_LABEL[role] : this.tr(label);
  }

  /** Translate, with optional `{placeholder}` substitution. */
  private tr(message: Ml, params: Record<string, string | number> = {}): string {
    return fmt(t(message, this.uiLang), params);
  }

  /** A core warning in the UI language (shared with the panels — see `i18n.warnText`). */
  private warnText(warning: EngWarning): string {
    return warnText(warning, this.uiLang);
  }


  override render(): TemplateResult {
    return html`
      ${this.renderHeader()}
      <div class="body">
        <!-- The equipment rail belongs to the DEVICES panel only. Elsewhere it was a
             third column: it pushed the catalogue list, the structure editor and the
             signal grid into whatever width was left, and none of those screens is
             about picking an equipment. -->
        ${this.panel === 'devices' ? this.renderRail() : nothing}
        <main class="panel">
          ${this.panel === 'devices' ? this.renderDevicesPanel() : nothing}
          ${this.panel === 'books' ? this.renderBooksPanel() : nothing}
          ${this.panel === 'model' ? this.renderModelPanel() : nothing}
          ${this.panel === 'instances' ? this.renderInstancesPanel() : nothing}
        </main>
      </div>
    `;
  }

  // --- header + rail ----------------------------------------------------------

  private renderHeader(): TemplateResult {
    const changes = this.plan?.items.length ?? 0;
    const conflicts = this.plan?.items.filter((i) => i.conflict).length ?? 0;
    return html`
      <header class="topbar">
        <wui-content-header
          .headerTitle=${this.tr(MSG.title)}
          .headerSubtitle=${this.tr(MSG.subtitle)}
          variant="secondary"
        ></wui-content-header>
        <div class="spacer"></div>
        ${this.gateway.isDemo
          ? html`<ix-chip outline variant="warning" icon="info">${this.tr(MSG.demoBanner)}</ix-chip>`
          : nothing}
        ${conflicts > 0
          ? html`<ix-chip variant="alarm" title=${this.tr(MSG.conflictTitle)}>${this.tr(MSG.conflictChip)} ${conflicts}</ix-chip>`
          : nothing}
      </header>
      <ix-tabs
        .selected=${PANEL_ORDER.indexOf(this.panel)}
        @selectedChange=${(event: CustomEvent<number>) => this.onTab(event.detail)}
      >
        <ix-tab-item>${this.tr(MSG.stepDevices)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepBooks)}${countSuffix(this.books.length)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepModel)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepInstances)}${countSuffix(changes)}</ix-tab-item>
      </ix-tabs>
      ${this.notice === ''
        ? nothing
        : html`<ix-message-bar
            class="notice"
            type="info"
            @closedChange=${() => (this.notice = '')}
          >${this.notice}</ix-message-bar>`}
    `;
  }

  /** `ix-tabs` reports an INDEX; the panel is the state everything else reads. */
  private onTab(index: number): void {
    const panel = PANEL_ORDER[index];
    if (panel !== undefined) this.panel = panel;
  }

  private renderRail(): TemplateResult {
    return html`
      <aside class="rail">
        <div class="rail-head">${this.tr(MSG.devicesRail)}</div>
        ${this.devices.map((device) => this.renderDeviceRow(device))}
        <div class="rail-foot">
          ${this.can('manage-devices')
            ? html`<ix-button variant="secondary" icon="plus" @click=${this.onAddDevice}>${this.tr(MSG.addDevice)}</ix-button>`
            : nothing}
        </div>
      </aside>
    `;
  }

  private renderDeviceRow(device: Device): TemplateResult {
    const selected = device.id === this.selectedDeviceId;
    return html`
      <button
        class="device ${selected ? 'selected' : ''}"
        title=${`${device.name} — ${this.stateLabel(device)}. ${this.stateWhy(device)}`}
        @click=${() => this.selectDevice(device.id)}
      >
        <span class="led ${device.state}" aria-label=${this.stateLabel(device)}></span>
        <span class="device-name">${device.name}</span>
        ${device.bookIds.length > 1 ? html`<span class="chip">${this.tr(MSG.bookCount, { n: device.bookIds.length })}</span>` : nothing}
        <span class="chip proto">${this.protocolLabel(device)}</span>
      </button>
    `;
  }

  private protocolLabel(device: Device): string {
    const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
    return device.protocol ? map[device.protocol] ?? device.protocol : '—';
  }

  // --- connection state (LED + words) -----------------------------------------

  /**
   * The equipment's connection state as a coloured LED AND as a word.
   *
   * The colour alone would not be readable enough to act on: green/red/grey needs a
   * legend nobody has, it fails for a colour-blind operator, and grey has three
   * distinct causes (see the core's `DeviceStateSource`). So the badge always spells
   * the state out, names the connection it was read on, and carries the reason as its
   * tooltip — which is also what makes an `unknown` actionable instead of worrying.
   */
  private renderDeviceState(device: Device): TemplateResult {
    const connection = device.stateConnection ?? '';
    const detail = this.stateCodeLabel(device);
    return html`
      <span class="state-badge ${device.state}" title=${this.stateWhy(device)}>
        <span class="led ${device.state}"></span>
        <span>${this.stateLabel(device)}</span>
        ${detail === '' ? nothing : html`<span class="soft small">· ${detail}</span>`}
        ${connection === '' ? nothing : html`<span class="soft small mono">${this.tr(MSG.stateVia, { connection })}</span>`}
      </span>
    `;
  }

  private stateLabel(device: Device): string {
    if (device.state === 'connected') return this.tr(MSG.stateConnected);
    return device.state === 'disconnected' ? this.tr(MSG.stateDisconnected) : this.tr(MSG.stateUnknown);
  }

  /**
   * The driver's own word for the raw code, when it says MORE than the LED does.
   *
   * Shown only when it adds something: repeating "connected · connected" next to a
   * green lamp is noise, but "disconnected · inactive (connection disabled)" is the
   * difference between calling maintenance and re-enabling a connection. An
   * undocumented code is shown as the number rather than dropped — a state the studio
   * does not know is exactly what an engineer needs to see.
   */
  private stateCodeLabel(device: Device): string {
    const code = device.stateCode;
    // The two codes the lamp already says in full: connected (which leg of a redundant
    // pair answered stays in the tooltip) and plainly not connected. "Disconnected ·
    // not connected" is noise; "disconnected · failure" is not.
    if (code === undefined || code >= CONN_STATE.CONNECTED || code === CONN_STATE.NOT_CONNECTED) return '';
    const known = MSG.connStateCode[String(code)];
    return known === undefined ? `ConnState ${code}` : t(known, this.uiLang);
  }

  /**
   * Why the state says what it says. An older backend (or a fixture) sends no
   * `stateSource`; the reason is then simply absent rather than invented.
   */
  private stateWhy(device: Device): string {
    const why = device.stateSource === undefined ? undefined : MSG.stateWhy[device.stateSource];
    if (why === undefined) return this.stateLabel(device);
    return fmt(t(why, this.uiLang), { connection: device.stateConnection ?? '—', code: device.stateCode ?? '—' });
  }

  // --- book helpers (many-to-many) --------------------------------------------

  private bookById(id: string | null): AddressBook | null {
    return id == null ? null : this.books.find((b) => b.id === id) ?? null;
  }

  /** Books of the selected device, in its declared order. */
  private booksOfDevice(device: Device): AddressBook[] {
    return device.bookIds.map((id) => this.bookById(id)).filter((b): b is AddressBook => b != null);
  }

  /** The active book (selected device's chosen book). */
  private activeBook(): AddressBook | null {
    return this.bookById(this.selectedBookId);
  }

  /** Names of the OTHER equipments that share a book (mutualisation indicator). */
  private otherDevicesSharing(bookId: string): string[] {
    return this.devices.filter((d) => d.id !== this.selectedDeviceId && d.bookIds.includes(bookId)).map((d) => d.name);
  }

  // --- panel 1: devices + books -----------------------------------------------

  private renderDevicesPanel(): TemplateResult {
    // The form takes over the panel: creating an equipment must not require one to
    // already exist (the empty-project case), and editing is the same screen.
    if (this.deviceDraft) return this.renderDeviceForm(this.deviceDraft);
    const device = this.currentDevice();
    if (!device) {
      return html`<div class="empty">
        ${this.tr(MSG.noDevice)}
        ${this.can('manage-devices')
          ? html`<div class="empty-action">
              <ix-button variant="primary" icon="plus" @click=${this.onAddDevice}>${this.tr(MSG.addDevice)}</ix-button>
            </div>`
          : nothing}
      </div>`;
    }
    const books = this.booksOfDevice(device);
    return html`
      <div class="panel-head">
        <h2>${device.name}</h2>
        <span class="chip proto">${this.protocolLabel(device)}</span>
        ${this.renderDeviceState(device)}
        <span class="chip">${this.tr(MSG.bookCount, { n: books.length })}</span>
        <div class="spacer"></div>
        ${this.can('manage-devices')
          ? html`<ix-button variant="secondary" icon="pen" @click=${() => this.onEditDevice(device)}>${this.tr(MSG.deviceEdit)}</ix-button>`
          : nothing}
      </div>
      <div class="panel-scroll">
        ${this.renderDeviceModelDps(device)}
        ${this.renderDeviceBooks(books)}
      </div>
    `;
  }

  /**
   * The equipment's catalogs, as LINKS — nothing more.
   *
   * The device screen used to embed the whole book detail: interface cards, the
   * online browse form, the signal table. All of it exists in the Catalogues panel
   * — same table, same state, passed there through the `signals` slot — so keeping
   * a second copy here cost width, duplicated a workflow, and let the two screens
   * drift. Field request settled it: the device screen is about the EQUIPMENT
   * (its state, its model datapoints, which catalogs it reads); the book work —
   * qualification, browse, refresh — belongs to the Catalogues tab. One click on a
   * link opens that tab on the book.
   */
  private renderDeviceBooks(books: AddressBook[]): TemplateResult {
    return html`
      <section class="card book-links">
        <div class="card-title">${this.tr(MSG.books)}</div>
        ${books.length === 0
          ? html`<div class="empty small">${this.tr(MSG.noBookHint)}</div>`
          : books.map((book) => this.renderBookLink(book))}
      </section>
    `;
  }

  /** One catalog link: identity + counts here, everything else in the Catalogues tab. */
  private renderBookLink(book: AddressBook): TemplateResult {
    const shared = this.otherDevicesSharing(book.id).length > 0;
    return html`
      <button class="book-link" title=${this.tr(MSG.bookLinkHint, { name: book.name })} @click=${() => this.openBookInPanel(book.id)}>
        <span class="book-tab-name">${book.name}</span>
        <span class="chip mode">${book.interface ? this.protocolOf(book.interface.protocol) : this.tr(MSG.catalogChip)}</span>
        <span class="chip">${this.tr(MSG.entriesChip, { n: book.entries.length })}</span>
        ${shared ? html`<span class="chip" title=${this.tr(MSG.sharedBook)}>⇆</span>` : nothing}
        <span class="spacer"></span>
        <span class="book-link-go" aria-hidden="true">→</span>
      </button>
    `;
  }

  /** The links' target: the Catalogues panel, opened on that book. */
  private openBookInPanel(bookId: string): void {
    this.selectBook(bookId);
    this.panel = 'books';
  }

  /**
   * The MODEL's datapoints bound to THIS equipment — and only those.
   *
   * The Model panel's grid shows the whole workspace; an operator standing on an
   * equipment wants the opposite cut: which datapoints the model actually ties to
   * this machine. The link is `AddressConfig.deviceId` — the studio-side provenance
   * every generated address records (see the core's `AddressConfig`) — so the list
   * is exact, not a name heuristic. A DP is shown WHOLE once any of its DPEs is
   * bound here: the datapoint is the unit an operator reasons about, and its
   * config-less leaves are information too.
   */
  private renderDeviceModelDps(device: Device): TemplateResult {
    const ws = this.workspace;
    if (!ws) return html``;
    const rows = this.deviceGridRows(ws, device.id);
    const dpCount = new Set(rows.map((row) => dpNameOf(row.dpe))).size;
    return html`
      <section class="card signals model-dps">
        <div class="signals-head">
          <div class="card-title">${this.tr(MSG.deviceModelDps)}</div>
          <span class="chip">${this.tr(MSG.dpsCount, { n: dpCount })}</span>
          <span class="soft signals-count">${this.tr(MSG.deviceModelDpsHint)}</span>
        </div>
        ${rows.length === 0
          ? html`<div class="empty small">${this.tr(MSG.deviceModelDpsEmpty)}</div>`
          : html`
              <div class="grid-scroll">
                <table class="grid">
                  <thead>
                    <tr>
                      <th>${this.tr(MSG.colDpe)}</th><th>${this.tr(MSG.colType)}</th><th>${this.tr(MSG.colAddress)}</th>
                      <th>${this.tr(MSG.colDir)}</th><th>${this.tr(MSG.colAlarm)}</th><th>${this.tr(MSG.colArchive)}</th>
                      <th>${this.tr(MSG.colRange)}</th><th>${this.tr(MSG.colLiveValue)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map((row) => this.renderGridRow(row))}
                  </tbody>
                </table>
              </div>
            `}
      </section>
    `;
  }

  /**
   * Device declaration form — create or edit one equipment.
   *
   * The connection fields are rendered FROM THE CORE's `PROTOCOL_PARAMS` spec, so
   * adding a protocol never touches this page: the spec says what a field is, the
   * i18n table says what it is called. Validation problems come from the core too
   * (`validateDevice`), which is what the backend re-runs — the form cannot be
   * stricter or laxer than the store.
   */
  private renderDeviceForm(draft: DeviceDraft): TemplateResult {
    const editing = this.deviceFormId !== '';
    const blocking = blockingProblems(this.deviceProblems);
    const advisory = this.deviceProblems.filter((problem) => !blocking.includes(problem));
    const allSpecs = PROTOCOL_PARAMS[draft.protocol] ?? [];
    const specs = allSpecs.filter((spec) => spec.declarative !== true && spec.section === undefined);
    // Parameters that only RECORD how the driver is configured elsewhere get their
    // own card: shown among the connection fields they would read as settings the
    // studio applies, which they are not.
    const declarative = allSpecs.filter((spec) => spec.declarative === true && spec.section === undefined);
    // The OPC UA security block: written to the LIVE connection at save time, so it
    // gets its own card — mixing it into the connection fields would hide that
    // these have an immediate effect on the project.
    const security = allSpecs.filter((spec) => spec.section === 'security');
    const device = editing ? this.devices.find((d) => d.id === this.deviceFormId) : undefined;
    return html`
      <div class="panel-head">
        <h2>${this.tr(editing ? MSG.deviceFormEdit : MSG.deviceFormNew, { name: draft.name || '…' })}</h2>
        <div class="spacer"></div>
        ${editing && device
          ? html`<ix-button
              icon="trashcan"
              variant=${this.deviceDeleteArmed ? 'danger-primary' : 'danger-secondary'}
              ?disabled=${this.busy}
              @click=${() => this.onDeleteClick(device)}
            >
              ${this.tr(this.deviceDeleteArmed ? MSG.deviceDeleteConfirm : MSG.deviceDelete)}
            </ix-button>`
          : nothing}
        <ix-button variant="tertiary" @click=${() => this.closeDeviceForm()}>${this.tr(MSG.cancel)}</ix-button>
        <ix-button
          variant="primary"
          icon="check"
          ?disabled=${this.busy || blocking.length > 0 || !this.can('manage-devices')}
          @click=${() => void this.onSaveDevice()}
        >
          ${this.tr(MSG.save)}
        </ix-button>
      </div>
      <div class="panel-scroll">
        <div class="eng-form">
          ${this.deviceDeleteArmed
            ? html`<ix-message-bar type="alarm" persistent>${this.tr(MSG.deviceDeleteHint)}</ix-message-bar>`
            : nothing}
          <section class="card">
            <div class="card-title">${this.tr(MSG.deviceIdentity)}</div>
            <label class="form-row">
              <span>${this.tr(MSG.deviceName)}</span>
              <ix-input
                placeholder="Z01_FOUR001"
                .value=${draft.name}
                @valueChange=${(event: CustomEvent<string>) => this.patchDraft({ name: String(event.detail) })}
              ></ix-input>
            </label>
            <div class="form-hint">
              ${editing
                ? this.tr(MSG.deviceIdFixed, { id: this.deviceFormId })
                : this.tr(MSG.deviceIdDerived, { id: draft.name.trim() === '' ? '…' : deviceIdFrom(draft.name) })}
            </div>
            <label class="form-row">
              <span>${this.tr(MSG.deviceProtocol)}</span>
              <ix-select
                .value=${draft.protocol ?? ''}
                @valueChange=${(event: CustomEvent<string | string[]>) => this.patchDraftProtocol(firstOf(event.detail))}
              >
                ${PROTOCOLS.map(
                  (protocol) => html`<ix-select-item value=${protocol} label=${this.protocolOf(protocol)}></ix-select-item>`
                )}
              </ix-select>
            </label>
          </section>

          <section class="card">
            <div class="card-title">${this.tr(MSG.deviceConnection, { protocol: this.protocolOf(draft.protocol) })}</div>
            ${specs.map((spec) => this.renderParamRow(draft, spec))}
            <label class="form-row">
              <span>${this.tr(MSG.deviceDriverNumber)}</span>
              ${renderDriverSelect({
                drivers: this.drivers,
                value: draft.driverNumber,
                lang: this.uiLang,
                // Only the drivers that can serve this protocol, never the simulator.
                protocol: draft.protocol,
                onChange: (value) => this.patchDraft({ driverNumber: value })
              })}
            </label>
            <div class="form-hint">${this.driverHint(draft.protocol)}</div>
            ${this.renderDriverMismatch(draft)}
            <label class="form-row">
              <span>${this.tr(MSG.devicePollGroup)}</span>
              <ix-input
                placeholder="_EngStudio_Poll"
                .value=${draft.pollGroup ?? ''}
                @valueChange=${(event: CustomEvent<string>) => this.patchDraft({ pollGroup: String(event.detail) })}
              ></ix-input>
            </label>
            <div class="form-hint">${this.tr(MSG.devicePollGroupHint)}</div>
          </section>

          ${security.length === 0 ? nothing : this.renderSecurityCard(draft, security)}

          ${declarative.length === 0
            ? nothing
            : html`<section class="card">
                <div class="card-title">${this.tr(MSG.deviceDeclared)}</div>
                <div class="form-hint">${this.tr(MSG.deviceDeclaredHint)}</div>
                ${declarative.map((spec) => this.renderParamRow(draft, spec))}
              </section>`}

          <section class="card">
            <div class="card-title">${this.tr(MSG.deviceBooks)}</div>
            ${this.books.length === 0
              ? html`<div class="empty small">${this.tr(MSG.deviceNoBookYet)}</div>`
              : html`<div class="box-list">
                  ${this.books.map((book) => {
                    const shared = this.otherDevicesSharing(book.id).filter((name) => name !== draft.name);
                    return html`<label class="box" title=${book.name}>
                      <input
                        type="checkbox"
                        .checked=${draft.bookIds.includes(book.id)}
                        @change=${() => this.toggleDraftBook(book.id)}
                      />
                      <span class="box-name">${book.name}</span>
                      <span class="chip">${book.entries.length}</span>
                      ${shared.length > 0 ? html`<span class="chip" title=${shared.join(', ')}>⇆ ${shared.length}</span>` : nothing}
                    </label>`;
                  })}
                </div>`}
            <div class="form-hint">${this.tr(MSG.deviceBooksHint)}</div>
          </section>

          ${blocking.length > 0 || advisory.length > 0
            ? html`<section class="card warnings">
                <div class="card-title">${this.tr(MSG.deviceProblems)}</div>
                <ul>
                  ${blocking.map((problem) => html`<li class="warn-text">${this.warnText(problem)}</li>`)}
                  ${advisory.map((problem) => html`<li>${this.warnText(problem)}</li>`)}
                </ul>
              </section>`
            : nothing}
        </div>
      </div>
    `;
  }

  private protocolOf(protocol: string): string {
    const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
    return map[protocol] ?? protocol;
  }

  /**
   * Label of a connection parameter. The core owns WHICH parameters exist
   * (`PROTOCOL_PARAMS`); an unlabelled key falls back to the key itself, so a new
   * parameter is visible (raw) rather than blank.
   */
  private paramLabel(key: string): string {
    const label = PARAM_LABEL[key];
    return label === undefined ? key : this.tr(label);
  }

  /**
   * The sentence under the driver picker, told from the FILTERED list — the three
   * cases are genuinely different problems:
   *  - the project reports no driver at all (no runtime, no permission);
   *  - it has drivers but none can serve this protocol (the simulator is never
   *    offered, and an OPC UA client cannot serve a Modbus station);
   *  - there is a choice to make.
   * Saying "no driver listed" in the second case would send an operator looking for
   * a driver that is right there in the project.
   */
  private driverHint(protocol: ProtocolKind): string {
    if (this.drivers.length === 0) return this.tr(MSG.driverNoneListed);
    if (offerableDrivers(this.drivers, protocol).length === 0) {
      return this.tr(MSG.driverNoneForProtocol, { protocol: this.protocolOf(protocol) });
    }
    return this.tr(MSG.driverHint);
  }

  /**
   * The OPC UA SECURITY card: user / password / policy / mode / client
   * certificate, then the certificate-relaxation checkboxes (`Config.Flags`
   * bits — the standard panel's advanced settings). Apart from the connection
   * card because these are WRITTEN to the live connection at save time.
   */
  private renderSecurityCard(draft: DeviceDraft, security: DeviceParamSpec[]): TemplateResult {
    const fields = security.filter((spec) => spec.kind !== 'bit');
    const bits = security.filter((spec) => spec.kind === 'bit');
    return html`<section class="card">
      <div class="card-title">${this.tr(MSG.deviceSecurity)}</div>
      <div class="form-hint">${this.tr(MSG.deviceSecurityHint)}</div>
      ${fields.map((spec) => this.renderParamRow(draft, spec))}
      ${bits.length === 0
        ? nothing
        : html`
            <div class="form-hint">${this.tr(MSG.deviceCertFlagsHint)}</div>
            <div class="box-list bits">${bits.map((spec) => this.renderBitBox(draft, spec))}</div>
          `}
    </section>`;
  }

  /**
   * One `Config.Flags` bit as a checkbox. Unlike the tri-state `flag`, a bit that
   * was never touched stays ABSENT (the live bit is left alone); once toggled the
   * draft carries an explicit true/false and the save forces that bit.
   */
  private renderBitBox(draft: DeviceDraft, spec: DeviceParamSpec): TemplateResult {
    const value = draft.connection[spec.key];
    const checked = value === true || value === 'true';
    return html`<label class="box">
      <input
        type="checkbox"
        .checked=${checked}
        @change=${(event: Event) => this.patchDraftParam(spec.key, (event.target as HTMLInputElement).checked ? 'true' : 'false')}
      />
      <span class="box-name">${this.paramLabel(spec.key)}</span>
    </label>`;
  }

  /**
   * One connection-parameter row, rendered from the core's spec — the `kind` picks
   * the control, never a hand-written form per protocol.
   *
   * `flag` is a three-state SELECT, not a checkbox: for a declarative parameter,
   * "no" (someone checked) and "not stated" (nobody did) are different claims, and a
   * checkbox can only ever say one of them.
   */
  private renderParamRow(draft: DeviceDraft, spec: DeviceParamSpec): TemplateResult {
    const raw = draft.connection[spec.key];
    const current = raw === undefined || raw === null ? '' : String(raw);
    const label = html`<span>${this.paramLabel(spec.key)}${spec.required ? ' *' : ''}</span>`;
    // The OPC UA server name is not free text: it is the reference every address of the
    // equipment is bound through AND the connection its state is read on, so it is
    // picked from the project's own connections — see `eng-connection-select.ts`.
    // Classic S7 gets the same treatment, for the same reason: naming the
    // connection is what makes the equipment's state read EXACT (matched by name
    // rather than by searching its IP inside `_S7_Conn.Address`). Optional here,
    // so an equipment declared before its connection exists still saves.
    const connectionParam =
      (spec.key === 'server' && draft.protocol === 'opcua') || (spec.key === 'connection' && draft.protocol === 's7');
    if (connectionParam) {
      const offered = draft.protocol === 's7' ? this.s7Connections : this.connections;
      const hint = unknownConnectionHint(offered, current, this.uiLang);
      return html`
        <label class="form-row">
          ${label}
          ${renderConnectionSelect({
            connections: offered,
            value: current,
            lang: this.uiLang,
            ...(spec.example === undefined ? {} : { placeholder: spec.example }),
            onChange: (value) => this.patchDraftParam(spec.key, value)
          })}
        </label>
        ${hint === null ? nothing : html`<div class="form-hint warn-inline">${hint}</div>`}
      `;
    }
    // A SECRET is write-only: it is sent with the save, pushed to the runtime
    // (vendor-encrypted) and forgotten — so the field is always blank, and the
    // hint says whether the LIVE connection currently carries a password.
    if (spec.kind === 'secret') {
      const editing = this.devices.find((device) => device.id === this.deviceFormId);
      return html`<label class="form-row">
          ${label}
          <input
            class="filter"
            type="password"
            autocomplete="new-password"
            placeholder=${editing?.passwordSet === true ? '••••••••' : ''}
            .value=${current}
            @input=${(event: Event) => this.patchDraftParam(spec.key, (event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="form-hint">${this.tr(editing?.passwordSet === true ? MSG.devicePasswordSet : MSG.devicePasswordUnset)}</div>`;
    }
    if (spec.kind === 'choice' || spec.kind === 'flag') {
      const options = spec.kind === 'flag' ? ['true', 'false'] : (spec.options ?? []);
      return html`<label class="form-row">
        ${label}
        <ix-select
          allow-clear
          i18n-placeholder=${this.tr(MSG.paramUnset)}
          .value=${current}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.patchDraftParam(spec.key, firstOf(event.detail))}
        >
          ${options.map(
            (option) => html`<ix-select-item value=${option} label=${this.paramOption(spec.key, option)}></ix-select-item>`
          )}
        </ix-select>
      </label>`;
    }
    // A NUMERIC parameter keeps a native field on purpose: `ix-number-input` renders
    // an unset value as `0`, and this form must never show a rack of 0 that nobody
    // stated — the same reason the declarative flags are three-state selects.
    if (spec.kind === 'number' || spec.kind === 'port') {
      return html`<label class="form-row">
        ${label}
        <input
          class="filter mono"
          type="number"
          placeholder=${spec.example ?? ''}
          .value=${current}
          @input=${(event: Event) => this.patchDraftParam(spec.key, (event.target as HTMLInputElement).value)}
        />
      </label>`;
    }
    return html`<label class="form-row">
      ${label}
      <ix-input
        placeholder=${spec.example ?? ''}
        .value=${current}
        @valueChange=${(event: CustomEvent<string>) => this.patchDraftParam(spec.key, String(event.detail))}
      ></ix-input>
    </label>`;
  }

  /**
   * Advisory when the chosen driver's type contradicts the protocol. Only the OPC
   * UA `DT` string is verified, so this reports a suspicion and never blocks a save
   * — see `eng-driver-select.ts`.
   */
  private renderDriverMismatch(draft: DeviceDraft): TemplateResult {
    const hint = driverMismatchHint(this.drivers, draft.driverNumber, draft.protocol ?? '', this.uiLang);
    return hint === null ? html`` : html`<div class="form-hint warn-inline">${hint}</div>`;
  }

  /** Label of one option of a `choice`/`flag` parameter (`<key>.<value>`). */
  private paramOption(key: string, value: string): string {
    const label = PARAM_OPTION_LABEL[`${key}.${value}`];
    return label === undefined ? value : this.tr(label);
  }

  /**
   * Delta of the last source re-read — removals first, they are the risky ones.
   * Rendered in the CATALOGUES panel (above the signal table, through the `signals`
   * slot): that is where refresh and browse live since the device screen was
   * reduced to links.
   */
  private renderBookDelta(): TemplateResult {
    const delta = this.bookDelta;
    if (!delta) return html``;
    const unchanged = delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0;
    return html`
      <section class="card ${delta.removed.length > 0 ? 'warnings' : ''}">
        <div class="card-title">${this.tr(MSG.deltaTitle)}</div>
        ${unchanged
          ? html`<div class="empty small">${this.tr(MSG.deltaNoChange)}</div>`
          : html`
              ${delta.removed.length > 0
                ? html`<div class="warn-text">
                    <b>${this.tr(MSG.deltaRemoved, { n: delta.removed.length })}</b> ${this.tr(MSG.deltaRemovedHint)}
                    ${delta.removed.slice(0, 12).map((p) => html`<span class="chip mono">${p}</span> `)}
                    ${delta.removed.length > 12 ? html`<span class="small">…</span>` : nothing}
                  </div>`
                : nothing}
              ${delta.changed.length > 0
                ? html`<div>
                    <b>${this.tr(MSG.deltaChanged, { n: delta.changed.length })}</b> ${this.tr(MSG.deltaChangedHint)}
                    ${delta.changed.slice(0, 12).map((p) => html`<span class="chip mono">${p}</span> `)}
                  </div>`
                : nothing}
              ${delta.added.length > 0
                ? html`<div>
                    <b>${this.tr(MSG.deltaAdded, { n: delta.added.length })}</b>&nbsp;:
                    ${delta.added.slice(0, 12).map((p) => html`<span class="chip mono">${p}</span> `)}
                  </div>`
                : nothing}
            `}
      </section>
    `;
  }

  /** Signal table of the current device's address book (in the Devices panel). */
  private renderDeviceSignals(book: AddressBook): TemplateResult {
    const entries = this.visibleSignals(book);
    const modes = this.currentDevice()?.accessModes ?? [];
    const counts = this.roleTally(book);
    const allChecked = entries.length > 0 && entries.every((e) => this.checkedSignals.has(e.path));
    return html`
      <section class="card signals">
        <div class="signals-head">
          <div class="card-title">${this.tr(MSG.bookSignals)}</div>
          <input
            class="filter"
            placeholder=${this.tr(MSG.filterPlaceholder)}
            .value=${this.signalFilter}
            @input=${(e: Event) => (this.signalFilter = (e.target as HTMLInputElement).value)}
          />
          <select
            class="filter role-filter"
            .value=${this.roleFilter}
            @change=${(e: Event) => (this.roleFilter = (e.target as HTMLSelectElement).value as SignalRole | '')}
          >
            <option value="">${this.tr(MSG.allRoles)}</option>
            ${SIGNAL_ROLES.map(
              (role) => html`<option value=${role} ?selected=${this.roleFilter === role}>${this.roleLabel(role)} (${counts[role]})</option>`
            )}
          </select>
          <span class="soft signals-count">${this.tr(MSG.signalsOf, { shown: entries.length, total: book.entries.length })}</span>
          ${counts.unknown > 0
            ? html`<span class="chip conflict">${this.tr(MSG.toQualify, { n: counts.unknown })}</span>`
            : html`<span class="chip new">${this.tr(MSG.allQualified)}</span>`}
        </div>
        ${this.renderRoleBar(book, entries)}
        <div class="signals-scroll">
          <table class="grid">
            <thead>
              <tr>
                <th class="cb-col">
                  <input
                    type="checkbox"
                    title="Tout cocher (lignes filtrées)"
                    .checked=${allChecked}
                    @change=${() => this.toggleAllSignals(entries)}
                  />
                </th>
                <th>${this.tr(MSG.colPath)}</th><th>${this.tr(MSG.colRole)}</th><th>${this.tr(MSG.colType)}</th>
                <th>${this.tr(MSG.colUnit)}</th><th>${this.tr(MSG.colAccess)}</th><th>${this.tr(MSG.colHistory)}</th>
                <th>${this.tr(MSG.colAcq)}</th>
                <th>${this.tr(MSG.colSourceType)}</th><th>${this.tr(MSG.colTemplate)}</th>
                <th>${this.tr(MSG.colAddresses)}</th><th>${this.tr(MSG.colComment)}</th>
                <th class="cb-col"></th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((entry) => this.renderSignalRow(entry, modes, book))}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  /** Bulk role bar: re-apply the rules, or assign a role to the checked rows. */
  private renderRoleBar(book: AddressBook, visible: BookEntry[]): TemplateResult {
    const checked = visible.filter((e) => this.checkedSignals.has(e.path)).length;
    return html`
      <div class="role-bar">
        <ix-button
          variant="secondary"
          icon="cogwheel"
          ?disabled=${this.busy}
          title=${this.tr(MSG.applyRulesTitle)}
          @click=${() => this.onApplyRules(book)}
        >
          ${this.tr(MSG.applyRules)}
        </ix-button>
        <span class="soft">${this.tr(MSG.checkedCount, { n: checked })}</span>
        <select
          class="filter"
          ?disabled=${checked === 0 || !this.can(EDIT_MODEL)}
          @change=${(e: Event) => this.onBulkRole(book, (e.target as HTMLSelectElement).value as SignalRole)}
        >
          <option value="">${this.tr(MSG.assignRole)}</option>
          ${SIGNAL_ROLES.filter((r) => r !== 'unknown').map((role) => html`<option value=${role}>${this.roleLabel(role)}</option>`)}
        </select>
        <select
          class="filter"
          ?disabled=${checked === 0 || !this.can('manage-devices')}
          @change=${(e: Event) => this.onBulkAccess(book, (e.target as HTMLSelectElement).value)}
          title=${this.tr(MSG.fixAccessTitle)}
        >
          <option value="">${this.tr(MSG.fixAccess)}</option>
          <option value="r">${this.tr(MSG.accessReadOnly)}</option>
          <option value="w">${this.tr(MSG.accessWriteOnly)}</option>
          <option value="rw">${this.tr(MSG.accessReadWrite)}</option>
        </select>
        ${this.can('manage-devices')
          ? html`<ix-button
              variant="danger-secondary"
              icon="eye-cancelled"
              ?disabled=${checked === 0 || this.busy}
              title=${this.tr(MSG.hiddenTitle)}
              @click=${() => void this.onHideChecked(book)}
            >
              ${this.tr(MSG.hideChecked)}
            </ix-button>`
          : nothing}
        ${this.hiddenCount(book) > 0
          ? html`<span class="chip update" title=${this.tr(MSG.hiddenTitle)}>${this.tr(MSG.hiddenCount, { n: this.hiddenCount(book) })}</span>
              ${this.can('manage-devices')
                ? html`<ix-button variant="tertiary" ?disabled=${this.busy} @click=${() => void this.onRestoreHidden(book)}>
                    ${this.tr(MSG.restoreHidden)}
                  </ix-button>`
                : nothing}`
          : nothing}
        ${checked > 0
          ? html`<ix-button variant="tertiary" @click=${() => (this.checkedSignals = new Set())}>${this.tr(MSG.uncheckAll)}</ix-button>`
          : nothing}
      </div>
    `;
  }

  /**
   * Access chip + its PROVENANCE, because the two lead to different directions:
   * an `assumed` access (a browse with no `AccessLevel`) is not evidence, so the
   * role's write intent wins — the operator must be able to see which one it is.
   */
  private renderAccessChip(entry: BookEntry): TemplateResult {
    const source = entry.accessSource ?? 'declared';
    const title = this.tr(
      { declared: MSG.accessDeclared, assumed: MSG.accessAssumed, manual: MSG.accessManual }[source]
    );
    return html`<span class="chip acc acc-${source}" title=${title}>
      ${entry.access}${source === 'assumed' ? '?' : source === 'manual' ? '✎' : ''}
    </span>`;
  }

  /**
   * Does the SOURCE keep a history of this signal — beside the access mode,
   * because the two are read together: `rw` says how it can be bound, "H" says
   * the machine already archives it, which is what decides whether WinCC OA
   * should archive it too.
   *
   * Three states, like the access provenance: yes, no, and NOTHING SAID (a
   * Modbus register map, a browse whose driver exposes no `AccessLevel`). A dash
   * for "unknown" and a dash for "no" would be the same lie the access chip's
   * `?` exists to avoid.
   */
  private renderHistoryChip(entry: BookEntry): TemplateResult {
    if (entry.historized === undefined) {
      return html`<span class="soft" title=${this.tr(MSG.historyUnknown)}>—</span>`;
    }
    return entry.historized
      ? html`<span class="chip hist" title=${this.tr(MSG.historyYes)}>H</span>`
      : html`<span class="chip hist-no" title=${this.tr(MSG.historyNo)}>—</span>`;
  }

  /**
   * HOW this signal would be acquired — polling or subscription — read from its ROLE.
   *
   * The rule already exists and already decides (`defaultLeafPolicy`: a fault and a state are
   * pushed, everything else is sampled), but until now it only became visible one screen later,
   * in the model's structure tree, one leaf at a time. Qualifying a catalog is exactly the moment
   * an engineer asks "how many of these will end up subscribed?", so the answer belongs in the
   * column beside the role that produces it. It is READ-ONLY here: the role decides it, and the
   * per-element override stays where an override belongs, on the model.
   *
   * Two honest exceptions, both mirroring what the generator really does:
   *  - an UNQUALIFIED signal gets no config at all, so it has no acquisition — a dash, not a
   *    default that would suggest something will be written;
   *  - only OPC UA subscribes. On any other catalog a subscription falls back to polling at
   *    generation (`SUBSCRIPTION_MISSING`), so showing "souscription" here would announce a mode
   *    the driver cannot honour.
   */
  private renderAcquisitionChip(entry: BookEntry, role: SignalRole, book: AddressBook): TemplateResult {
    if (role === 'unknown') {
      return html`<span class="soft" title=${this.tr(MSG.acqUnqualified)}>—</span>`;
    }
    const protocol = book.interface?.protocol;
    if (protocol !== undefined && protocol !== 'opcua') {
      return html`<span class="chip acq-poll" title=${this.tr(MSG.acqNotOpcua, { protocol: this.protocolOf(protocol) })}
        >${this.tr(MSG.acqPoll)}</span
      >`;
    }
    const spont = defaultLeafPolicy(entry, role).acquisition?.mode === 'spont';
    const label = this.roleLabel(role);
    return spont
      ? html`<span class="chip acq-spont" title=${this.tr(MSG.acqFromRoleSpont, { role: label })}>${this.tr(MSG.acqSpont)}</span>`
      : html`<span class="chip acq-poll" title=${this.tr(MSG.acqFromRolePoll, { role: label })}>${this.tr(MSG.acqPoll)}</span>`;
  }

  private renderSignalRow(entry: BookEntry, deviceModes: string[], book: AddressBook): TemplateResult {
    // Order the candidate addresses by the device's access modes first.
    const present = Object.keys(entry.addresses);
    const ordered = [...deviceModes.filter((m) => present.includes(m)), ...present.filter((m) => !deviceModes.includes(m))];
    const role = entry.role ?? 'unknown';
    return html`
      <tr>
        <td class="cb-col">
          <input type="checkbox" .checked=${this.checkedSignals.has(entry.path)} @change=${() => this.toggleSignal(entry.path)} />
        </td>
        <td class="mono dpe">${entry.path}</td>
        <td>${this.renderRoleCell(entry, role, book)}</td>
        <td>${entry.leafType}${entry.unmapped ? html` <span class="chip conflict" title="type non mappé">?</span>` : nothing}</td>
        <td class="unit">${entry.unit ?? html`<span class="soft">—</span>`}</td>
        <td>${this.renderAccessChip(entry)}</td>
        <td>${this.renderHistoryChip(entry)}</td>
        <td>${this.renderAcquisitionChip(entry, role, book)}</td>
        <td class="soft mono">${entry.sourceType}</td>
        <td class="soft">${entry.typeId ?? '—'}</td>
        <td class="addr-cell">
          ${ordered.length === 0
            ? html`<span class="soft">—</span>`
            : ordered.map(
                (mode) => html`<div class="addr-line"><span class="chip mode">${mode}</span><code>${entry.addresses[mode as keyof typeof entry.addresses]}</code></div>`
              )}
        </td>
        <td class="soft comment">${entry.comment ?? ''}</td>
        <td class="cb-col">
          ${this.can('manage-devices')
            ? html`<button
                class="row-hide"
                ?disabled=${this.busy}
                title=${this.tr(MSG.hideSignal)}
                @click=${() => void this.onHideSignal(book, entry.path)}
              >
                ⊘
              </button>`
            : nothing}
        </td>
      </tr>
    `;
  }

  /**
   * The role cell: the chip, click-to-edit into a picker.
   *
   * Why click-to-edit rather than a dropdown in every row — the two things a role
   * cell has to do at once. The **chip** carries information a `<select>` cannot: the
   * role's colour (readable down a column of hundreds of rows) and, as its tooltip,
   * WHY the signal has that role — the matching rule, or the fact that a hand
   * overrode it and what the rules would have said instead. The **picker** is what
   * makes tagging one signal a single click, without checking a box and reaching for
   * the bulk bar. Swapping one for the other on demand keeps both, and keeps exactly
   * ONE control alive in a table that draws thousands of rows.
   */
  private renderRoleCell(entry: BookEntry, role: SignalRole, book: AddressBook): TemplateResult {
    if (this.editingRole !== entry.path) {
      return html`<button
        class="chip role role-${role} role-tag"
        ?disabled=${!this.can(EDIT_MODEL) || this.busy}
        title=${this.roleReason(entry)}
        @click=${() => (this.editingRole = entry.path)}
      >
        ${this.roleLabel(role)}
      </button>`;
    }
    return html`<select
      class="filter role-cell"
      autofocus
      @change=${(event: Event) => void this.onSetRole(book, entry, (event.target as HTMLSelectElement).value as SignalRole | '')}
      @blur=${() => (this.editingRole = null)}
    >
      <!-- First option = hand the signal back to the rules; a manual role outranks
           every rule, so without it a mis-click would pin a wrong role for good. -->
      <option value="" ?selected=${entry.role === undefined}>${this.tr(MSG.roleFromRule)}</option>
      ${SIGNAL_ROLES.filter((candidate) => candidate !== 'unknown').map(
        (candidate) => html`<option value=${candidate} ?selected=${entry.role === candidate}>${this.roleLabel(candidate)}</option>`
      )}
    </select>`;
  }

  /**
   * Tag (or un-tag) ONE signal's role. `''` clears the override, so the rule engine
   * takes the signal back — which is what makes this safe to click.
   */
  private async onSetRole(book: AddressBook, entry: BookEntry, role: SignalRole | ''): Promise<void> {
    this.editingRole = null;
    if (role === (entry.role ?? '')) return; // nothing chosen, or the same value
    this.busy = true;
    try {
      await this.gateway.saveBookRoles(book.id, { [entry.path]: role });
      const fresh = await this.gateway.getBook(book.id);
      if (fresh) this.books = this.books.map((candidate) => (candidate.id === fresh.id ? fresh : candidate));
      // Report the role the signal ENDED UP with: clearing an override hands it back
      // to the rules, and their answer is the useful thing to show.
      const applied = fresh?.entries.find((candidate) => candidate.path === entry.path)?.role ?? 'unknown';
      this.notice = this.tr(role === '' ? MSG.roleClearedOne : MSG.roleSetOne, {
        path: entry.path,
        role: this.roleLabel(applied)
      });
    } catch (error) {
      this.notice = this.tr(MSG.roleSetFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Hide ONE signal — the same reversible override as the bulk action. */
  private async onHideSignal(book: AddressBook, path: string): Promise<void> {
    this.busy = true;
    try {
      const fresh = await this.gateway.saveBookExcluded(book.id, { [path]: true });
      this.books = this.books.map((candidate) => (candidate.id === fresh.id ? fresh : candidate));
      this.notice = this.tr(MSG.hideDone, { n: 1 });
    } catch (error) {
      this.notice = this.tr(MSG.hideFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  // --- panel 2: catalogues (address books, without any equipment) --------------

  /**
   * The Catalogues panel. The element owns the list, the detail and the creation
   * form; the page keeps the SELECTION and the form's visibility (so a refusal
   * leaves the form open with its fields) and performs every gateway call.
   *
   * The signal table is passed in through the `signals` slot rather than
   * duplicated: it is the very same table as the Devices panel's, with the same
   * filter and role state — state the page owns because the model generator reads
   * it (`visibleSignals`).
   */
  private renderBooksPanel(): TemplateResult {
    const book = this.activeBook();
    return html`
      <wui-eng-books
        .books=${this.books}
        .devices=${this.devices}
        .drivers=${this.drivers}
        .connections=${this.connections}
        .selectedBookId=${this.selectedBookId ?? ''}
        .canManage=${this.can('manage-devices')}
        .busy=${this.busy}
        .formOpen=${this.bookFormOpen}
        .error=${this.bookFormError}
        .uiLang=${this.uiLang}
        .walking=${this.walking}
        .browseLevel=${this.browseLevelForExplorer}
        .s7plusConnections=${this.s7plusConnections}
        .s7plusManager=${this.s7plusManager}
        .s7plusSources=${this.s7plusSourcesForForm}
        .browseS7PlusLevel=${this.browseS7PlusLevelForExplorer}
        .s7BrowseAvailable=${this.s7BrowseAvailable}
        .s7Inventory=${this.s7Inventory}
        .s7InventoryBusy=${this.s7InventoryBusy}
        @wui:bookselect=${(event: CustomEvent<{ bookId: string }>) => this.selectBook(event.detail.bookId)}
        @wui:booknew=${() => this.openBookForm()}
        @wui:bookcancel=${() => this.closeBookForm()}
        @wui:bookingest=${(event: CustomEvent<BookIngestDetail>) => void this.onIngestBook(event.detail)}
        @wui:bookbrowse=${(event: CustomEvent<BookBrowseDetail>) => void this.onDeclareAndWalk(event.detail)}
        @wui:booksymbolicbrowse=${(event: CustomEvent<BookS7PlusBrowseDetail>) => void this.onDeclareAndWalkS7Plus(event.detail)}
        @wui:bookwalk=${(event: CustomEvent<{ bookId: string }>) => void this.onWalkBook(event.detail.bookId)}
        @wui:bookwalkstop=${() => (this.walkCancelled = true)}
        @wui:bookrefresh=${(event: CustomEvent<{ bookId: string }>) => void this.onRefreshBookById(event.detail.bookId)}
        @wui:bookinventory=${(event: CustomEvent<{ bookId: string }>) => void this.onS7Inventory(event.detail.bookId)}
        @wui:bookdelete=${(event: CustomEvent<{ bookId: string }>) => void this.onDeleteBook(event.detail.bookId)}
        @wui:bookattach=${(event: CustomEvent<{ bookId: string; deviceIds: string[] }>) => void this.onAttachBook(event.detail)}
      >
        ${this.bookFormOpen || book === null
          ? nothing
          : html`<div slot="signals">${this.renderBookDelta()}${this.renderDeviceSignals(book)}</div>`}
      </wui-eng-books>
    `;
  }

  private openBookForm(): void {
    this.bookFormOpen = true;
    this.bookFormError = '';
  }

  private closeBookForm(): void {
    this.bookFormOpen = false;
    this.bookFormError = '';
  }

  /** Ingest a source file into a catalog, then attach it to the chosen equipments. */
  private async onIngestBook(detail: BookIngestDetail): Promise<void> {
    this.busy = true;
    this.bookFormError = '';
    try {
      const { book, books } = await this.gateway.ingestBook(detail.request as IngestRequest);
      this.books = books;
      this.selectedBookId = book.id;
      await this.attachBookTo(book.id, detail.attachTo);
      this.closeBookForm();
      this.notice = this.tr(MSG.bookCreated, {
        name: book.name,
        n: book.entries.length,
        warnings: book.warnings.length
      });
    } catch (error) {
      // The form stays open with its fields: re-picking the files to fix a name
      // would be the wrong lesson to teach.
      this.bookFormError = this.tr(MSG.bookCreateFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** One browse round-trip, handed down so the form's explorer needs no gateway. */
  private readonly browseLevelForExplorer = (connection: string, nodeId?: string): Promise<OpcUaBrowseNode[]> =>
    this.gateway.browseLevel(connection, nodeId);

  /** The same, for an S7Plus item (the form never touches the gateway itself). */
  private readonly browseS7PlusLevelForExplorer = (
    connection: string,
    item?: string,
    hmiVisibleOnly?: boolean
  ): Promise<S7PlusBrowseNode[]> => this.gateway.browseS7PlusLevel(connection, item, hmiVisibleOnly);

  /**
   * The TIA sources of an S7Plus connection: the online marker first, then every
   * station of every export the driver found.
   *
   * Assembled HERE rather than in the form because it is two round-trips per project
   * (projects, then stations) — the form asks one question and gets one answer. The
   * online source is prepended unconditionally: the driver reports it as a station of
   * its own reserved project, and an engineer must not have to know that name to read
   * the machine.
   */
  private readonly s7plusSourcesForForm = async (connection: string): Promise<EngS7PlusStation[]> => {
    const projects = await this.gateway.listS7PlusProjects(connection);
    const sources: EngS7PlusStation[] = [{ name: this.tr(MSG.s7plusOnline), station: S7PLUS_ONLINE_STATION }];
    for (const project of projects) {
      if (project.online) continue; // already offered, under a name that reads
      // One export that cannot be listed must not lose the others: a TIA archive the
      // driver cannot open is exactly the case an engineer needs to see the rest for.
      const stations = await this.gateway.listS7PlusStations(connection, project.name).catch(() => [] as EngS7PlusStation[]);
      for (const station of stations) sources.push({ name: station.station, station: station.station });
    }
    return sources;
  };

  /**
   * The S7Plus counterpart of {@link onDeclareAndWalk}: declare the catalog, then
   * walk the station into it.
   *
   * The interface it declares depends on the SOURCE, and that is the whole point of
   * the distinction: reading the live PLC produces a catalog bound to that connection,
   * while reading a TIA export produces a TEMPLATE (no interface) — it describes an
   * engineered program, which each equipment binds to its own connection at
   * generation. The core makes the same call when it builds the book; declaring it
   * differently here would only make the first paint lie.
   */
  private async onDeclareAndWalkS7Plus(detail: BookS7PlusBrowseDetail): Promise<void> {
    const { bookId, connection, name, station, root, hmiVisibleOnly, driverNumber } = detail.request;
    const online = isS7PlusOnline(station);
    this.busy = true;
    this.bookFormError = '';
    try {
      if (!this.books.some((book) => book.id === bookId)) {
        const { books } = await this.gateway.createBook({
          bookId,
          name,
          ...(online
            ? {
                interface: {
                  protocol: 's7plus' as const,
                  connection,
                  params: { station },
                  ...(driverNumber === undefined ? {} : { driverNumber })
                }
              }
            : {})
        });
        this.books = books;
      }
      this.selectedBookId = bookId;
      await this.attachBookTo(bookId, detail.attachTo);
      this.closeBookForm();
      this.notice = this.tr(MSG.bookDeclared, { name: name || bookId });
    } catch (error) {
      this.bookFormError = this.tr(MSG.bookCreateFailed, { error: (error as Error).message });
      return;
    } finally {
      this.busy = false;
    }
    await this.onWalkS7PlusBook(bookId, { connection, station, name, root, hmiVisibleOnly, driverNumber });
  }

  /**
   * Walk an S7Plus station into a catalog, reporting progress and stoppable — the
   * exact twin of {@link onWalkBook}, over the S7Plus walker.
   *
   * `source` carries what a first walk knows and the stored book does not yet: a
   * template catalog has no interface to read the connection back from, so the
   * parameters have to travel from the form. A LATER walk of the same book reads them
   * from its recorded provenance instead.
   */
  private async onWalkS7PlusBook(
    bookId: string,
    source?: {
      connection: string;
      station: string;
      name?: string;
      root?: string;
      hmiVisibleOnly?: boolean;
      driverNumber?: number;
    }
  ): Promise<void> {
    const book = this.bookById(bookId);
    const recorded = book?.provenance.browse;
    const connection = source?.connection ?? book?.interface?.connection ?? recorded?.connection;
    const station = source?.station ?? recorded?.station ?? String(book?.interface?.params?.['station'] ?? '');
    if (connection === undefined || connection === '' || station === '') return;
    const root = source?.root ?? recorded?.root;
    const hmiVisibleOnly = source?.hmiVisibleOnly ?? recorded?.hmiVisibleOnly;
    const driverNumber = source?.driverNumber ?? book?.interface?.driverNumber;
    this.walkCancelled = false;
    this.walking = { requests: 0, entries: 0, path: '', depth: 0 };
    this.bookDelta = null;
    this.busy = true;
    try {
      const { book: walked, delta } = await this.gateway.walkS7PlusIntoBook({
        bookId,
        connection,
        station,
        ...(source?.name === undefined ? (book?.name === undefined ? {} : { name: book.name }) : { name: source.name }),
        ...(root === undefined ? {} : { root }),
        ...(hmiVisibleOnly === undefined ? {} : { hmiVisibleOnly }),
        ...(driverNumber === undefined ? {} : { driverNumber }),
        onProgress: (progress) => {
          if (this.walkCancelled) throw new Error(this.tr(MSG.walkCancelled));
          this.walking = progress;
        }
      });
      this.books = this.books.map((candidate) => (candidate.id === walked.id ? walked : candidate));
      this.bookDelta = delta ?? null;
      this.notice = this.tr(MSG.walkDone, {
        conn: connection,
        n: walked.entries.length,
        requests: this.walking?.requests ?? 0,
        delta: this.describeDelta(delta)
      });
    } catch (error) {
      this.notice = this.walkCancelled ? this.tr(MSG.walkCancelled) : this.tr(MSG.browseFailed, { error: (error as Error).message });
    } finally {
      this.walking = null;
      this.busy = false;
    }
  }

  /**
   * The ONLINE path of the creation form: DECLARE the catalog, then walk into it.
   *
   * Two steps, not one, because a walk of a real server takes minutes: committing the
   * identity first means the operator is not holding a form open while it runs, a walk
   * that is stopped or fails leaves a catalog to retry into rather than nothing, and
   * the progress can be shown where the catalog already is.
   */
  private async onDeclareAndWalk(detail: BookBrowseDetail): Promise<void> {
    const { bookId, connection, name, rootNodeId, driverNumber } = detail.request;
    this.busy = true;
    this.bookFormError = '';
    try {
      // A re-created id is a re-walk of the same catalog, so an existing one is fine.
      if (!this.books.some((book) => book.id === bookId)) {
        const { books } = await this.gateway.createBook({
          bookId,
          name,
          interface: { protocol: 'opcua', connection, ...(driverNumber === undefined ? {} : { driverNumber }) }
        });
        this.books = books;
      }
      this.selectedBookId = bookId;
      await this.attachBookTo(bookId, detail.attachTo);
      this.closeBookForm();
      this.notice = this.tr(MSG.bookDeclared, { name: name || bookId });
    } catch (error) {
      this.bookFormError = this.tr(MSG.bookCreateFailed, { error: (error as Error).message });
      return;
    } finally {
      this.busy = false;
    }
    await this.onWalkBook(bookId, rootNodeId);
  }

  /**
   * Walk a catalog's own server into it, reporting progress and stoppable.
   *
   * The walk runs level by level from HERE (see `data/walk.ts`), so every request
   * updates the progress panel and "Stop" can unwind it — the server-side one-shot
   * browse cannot do either. A cancelled or failed walk leaves the stored catalog
   * exactly as it was.
   */
  private async onWalkBook(bookId: string, rootNodeId?: string): Promise<void> {
    const book = this.bookById(bookId);
    // Which walker: the catalog's own provenance decides, never the caller. A book
    // read from an S7Plus station has no node id to walk from, and a re-walk that
    // asked the OPC UA port for one would fail on a connection that does not exist.
    if (book?.provenance.kind === 's7plus-browse' || book?.interface?.protocol === 's7plus') {
      await this.onWalkS7PlusBook(bookId);
      return;
    }
    const connection = book?.interface?.connection;
    if (connection === undefined) return;
    const root = rootNodeId ?? book?.provenance.browse?.rootNodeId;
    this.walkCancelled = false;
    this.walking = { requests: 0, entries: 0, path: '', depth: 0 };
    this.bookDelta = null;
    this.busy = true;
    try {
      const { book: walked, delta } = await this.gateway.walkIntoBook({
        bookId,
        connection,
        name: book?.name,
        ...(root === undefined ? {} : { rootNodeId: root }),
        ...(book?.interface?.driverNumber === undefined ? {} : { driverNumber: book.interface.driverNumber }),
        onProgress: (progress) => {
          // The core calls this on every request; throwing is how a walk is cancelled.
          if (this.walkCancelled) throw new Error(this.tr(MSG.walkCancelled));
          this.walking = progress;
        }
      });
      this.books = this.books.map((candidate) => (candidate.id === walked.id ? walked : candidate));
      this.bookDelta = delta ?? null;
      this.notice = this.tr(MSG.walkDone, {
        conn: connection,
        n: walked.entries.length,
        requests: this.walking?.requests ?? 0,
        delta: this.describeDelta(delta)
      });
    } catch (error) {
      this.notice = this.walkCancelled ? this.tr(MSG.walkCancelled) : this.tr(MSG.browseFailed, { error: (error as Error).message });
    } finally {
      this.walking = null;
      this.busy = false;
    }
  }

  /** Refresh one catalog by id (the panel's own button, any book). */
  /**
   * Read the CPU behind a classic-S7 catalog and show what it says about it.
   *
   * The equipment is chosen rather than typed: the catalog's users already declare
   * ip/rack/slot, so the first one that does is dialled. A shared catalog served by
   * several equipments is checked against ONE of them — which is honest, since a
   * template catalog describes a machine TYPE and each instance may have drifted
   * differently; the endpoint that answered is named in the result.
   */
  private async onS7Inventory(bookId: string): Promise<void> {
    const device = this.devices.find((candidate) => candidate.protocol === 's7' && (candidate.bookIds ?? []).includes(bookId));
    if (device === undefined) {
      this.notice = this.tr(MSG.s7NoDeviceForBook);
      return;
    }
    this.s7InventoryBusy = true;
    this.notice = '';
    try {
      const result = await this.gateway.s7Inventory(bookId, { deviceId: device.id });
      this.s7Inventory = { ...result, bookId };
    } catch (error) {
      // A PLC that does not answer is an ordinary field situation, not a page
      // failure: the catalog stays exactly as it was and the reason is shown.
      this.s7Inventory = null;
      this.notice = error instanceof Error ? error.message : String(error);
    } finally {
      this.s7InventoryBusy = false;
    }
  }

  private async onRefreshBookById(bookId: string): Promise<void> {
    const previous = this.selectedBookId;
    this.selectedBookId = bookId;
    await this.onRefreshBook();
    if (previous !== null && this.books.every((book) => book.id !== bookId)) this.selectedBookId = previous;
  }

  private async onDeleteBook(bookId: string): Promise<void> {
    const name = this.bookById(bookId)?.name ?? bookId;
    this.busy = true;
    try {
      const { books, devices } = await this.gateway.deleteBook(bookId);
      this.books = books;
      this.devices = devices;
      if (this.selectedBookId === bookId) {
        this.selectedBookId = this.currentDevice()?.bookIds[0] ?? books[0]?.id ?? null;
      }
      this.notice = this.tr(MSG.bookDeleted, { name });
    } catch (error) {
      this.notice = this.tr(MSG.bookDeleteFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  private async onAttachBook(detail: { bookId: string; deviceIds: string[] }): Promise<void> {
    this.busy = true;
    try {
      await this.attachBookTo(detail.bookId, detail.deviceIds, true);
      this.notice = this.tr(MSG.bookAttachDone, {
        name: this.bookById(detail.bookId)?.name ?? detail.bookId,
        n: detail.deviceIds.length
      });
    } catch (error) {
      this.notice = this.tr(MSG.bookAttachFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Make exactly `deviceIds` reference `bookId`.
   *
   * There is no book→devices endpoint on purpose: the relation lives on the DEVICE
   * (`Device.bookIds`), so this is N device upserts — one per equipment whose set
   * actually changes, never a blanket rewrite of the registry. `detach` is false
   * when a freshly created catalog is only being ADDED: the form's checkboxes then
   * say "also attach to these", not "and to no other".
   */
  private async attachBookTo(bookId: string, deviceIds: string[], detach = false): Promise<void> {
    const wanted = new Set(deviceIds);
    for (const device of this.devices) {
      const has = device.bookIds.includes(bookId);
      const should = wanted.has(device.id);
      if (has === should || (!should && !detach)) continue;
      const bookIds = should ? [...device.bookIds, bookId] : device.bookIds.filter((id) => id !== bookId);
      const saved = await this.gateway.saveDevice(device.id, { ...draftFromDevice(device), bookIds });
      this.devices = saved.devices;
    }
  }

  // --- panel 3: model (book browser + signal grid) -----------------------------

  /**
   * MASTER–DETAIL: the models on the left, the selected model's CONTENT on the right.
   *
   * The verbs sit where they act, which is the whole point of the split: add and
   * delete belong to the LIST (they change which models exist), while the sources,
   * the structure, the mapping, the deployment and "save" belong to the DETAIL (they
   * change one model). The previous single column stacked all of it and made
   * "which model" and "what is in it" compete for the same width.
   *
   * What is NOT here any more is the generator ("Generate the model from this book"):
   * applying a model to equipment produces INSTANCES, so it moved to the Instances tab,
   * on the model row it instantiates. This tab is now about defining models only — one
   * screen, one subject — and the workspace grid moved with it, since it shows what the
   * models produced rather than what they are.
   */
  private renderModelPanel(): TemplateResult {
    return html`
      <div class="split2 model">
        ${this.renderModelMaster()}
        ${this.renderModelDetail()}
      </div>
      ${this.dpPick === null ? nothing : this.renderDpPicker()}
    `;
  }

  /**
   * The DATAPOINT SEARCH behind a leaf's magnifier.
   *
   * The two lists the editor offers (alert classes, archive groups) are read from the
   * project, but they cannot be exhaustive — a class may be created after the page loaded,
   * or named outside the convention. So the magnifier searches the project's datapoints
   * directly (`GET /api/eng/dps`, WinCC OA wildcards) and the field takes whatever is
   * picked. The result count is capped by the backend, and a truncation is SAID: a list
   * that silently stops is worse than one that admits it stops.
   */
  private renderDpPicker(): TemplateResult {
    const pick = this.dpPick;
    if (pick === null) return html``;
    return html`
      <div class="dp-pick-backdrop" @click=${() => (this.dpPick = null)}></div>
      <section class="dp-pick" @click=${(event: Event) => event.stopPropagation()}>
        <div class="browser-head">
          <span>${this.tr(pick.field === 'alarmClass' ? MSG.policyAlarmClass : MSG.policyArchiveGroup)}</span>
          <span class="chip mono">${pick.leaf}</span>
          <span class="spacer"></span>
          <ix-icon-button
            size="16"
            variant="tertiary"
            icon="close"
            a11y-label=${this.tr(MSG.cancel)}
            @click=${() => (this.dpPick = null)}
          ></ix-icon-button>
        </div>
        <div class="dp-pick-body">
          <label class="gen-row"><span>${this.tr(MSG.dpSearch)}</span>
            <ix-input
              placeholder="_alert*"
              .value=${pick.pattern}
              @valueChange=${(event: CustomEvent<string>) => void this.searchDpPick(String(event.detail))}
            ></ix-input></label>
          <div class="form-hint">${this.tr(MSG.dpSearchHint)}</div>
          ${pick.results.length === 0
            ? html`<div class="empty small">${this.tr(MSG.dpSearchNone)}</div>`
            : html`<div class="dp-pick-list">
                ${pick.results.map(
                  (name) => html`<button class="model-row" @click=${() => this.applyDpPick(name)}>
                    <span class="mono model-row-name">${name}</span>
                  </button>`
                )}
              </div>`}
          ${pick.truncated ? html`<div class="form-hint warn-inline">${this.tr(MSG.dpSearchTruncated)}</div>` : nothing}
        </div>
      </section>
    `;
  }

  /** Open the search for one leaf's field, pre-filtered by the type it expects. */
  private async openDpPick(request: DpPickRequest): Promise<void> {
    const pattern = request.field === 'alarmClass' ? '_alert*' : '_NGA_G*';
    this.dpPick = { ...request, pattern, results: [], truncated: false };
    await this.searchDpPick(pattern);
  }

  private async searchDpPick(pattern: string): Promise<void> {
    const pick = this.dpPick;
    if (pick === null) return;
    this.dpPick = { ...pick, pattern };
    try {
      // The DP TYPE is not part of the query: the whole point of the magnifier is to reach
      // a datapoint the typed lists do not carry, so restricting it to `_AlertClass` here
      // would rebuild the very limit it exists to lift.
      const found = await this.gateway.searchDps(pattern === '' ? '*' : pattern);
      if (this.dpPick?.pattern === pattern) this.dpPick = { ...this.dpPick, results: found.dps, truncated: found.truncated };
    } catch (error) {
      this.notice = this.tr(MSG.dpSearchFailed, { error: (error as Error).message });
    }
  }

  /** Write the picked datapoint into the leaf's field, and close. */
  private applyDpPick(name: string): void {
    const pick = this.dpPick;
    if (pick === null) return;
    const current = this.genPolicy[pick.leaf];
    if (pick.field === 'alarmClass' && pick.range !== undefined) {
      // ONE range's class: the others keep theirs (see the tree's emitRangeClass).
      const thresholds = current?.alarm?.thresholds ?? [];
      const classes = [...(current?.alarm?.alarmClasses ?? [])];
      while (classes.length < thresholds.length) classes.push('');
      classes[pick.range] = name;
      this.patchPolicy(pick.leaf, { alarm: { active: true, ...current?.alarm, alarmClasses: classes } });
    } else if (pick.field === 'alarmClass') {
      this.patchPolicy(pick.leaf, { alarm: { active: true, ...current?.alarm, alarmClass: name } });
    } else {
      this.patchPolicy(pick.leaf, { archive: { active: true, ...current?.archive, group: name } });
    }
    this.dpPick = null;
  }

  /**
   * LEFT: the models, and the two actions that change which models exist.
   *
   * Real buttons, not icon buttons: "new" and "delete" are the two verbs a first-time
   * user needs to find on this screen, and a bare `+` in a header asked them to guess.
   * Each row also shows the CATALOGS the model reads — that is what tells two models of
   * the same machine apart, and it was invisible while only the type name was shown.
   */
  private renderModelMaster(): TemplateResult {
    const ws = this.workspace;
    return html`
      <section class="browser model-master">
        <div class="browser-head">
          <span>${this.tr(MSG.modelLibrary)}</span>
          <span class="chip">${this.models.length}</span>
        </div>
        <div class="model-master-scroll">
          ${this.models.length === 0 ? html`<div class="empty small">${this.tr(MSG.modelNone)}</div>` : nothing}
          ${this.models.map((model) => {
            const active = model.id === this.genModelId;
            const count = ws === null ? 0 : modelInstances(ws, model.typeName, null, this.live).length;
            return html`
              <button class="model-row ${active ? 'active' : ''}" title=${model.typeName} @click=${() => this.onLoadModel(model.id)}>
                <span class="mono model-row-name">${model.name}</span>
                <span class="chip mode">${model.typeName}</span>
                ${count === 0 ? nothing : html`<span class="chip">${this.tr(MSG.instancesOfModel, { n: count })}</span>`}
                ${this.renderModelSync(model)}
                ${model.description === undefined || model.description.trim() === ''
                  ? nothing
                  : html`<span class="model-row-desc soft small">${model.description}</span>`}
                ${this.renderModelRowSources(model)}
              </button>
            `;
          })}
        </div>
      </section>
    `;
  }

  /**
   * Is the model still what the project's DP TYPE holds?
   *
   * A model is a house standard and the type it produced lives on in the project — where it
   * can be edited in PARA, or left behind when the model moves on. So the row says which of
   * the three it is, on the same fingerprint the check-in diff uses (`modelSyncState`), and
   * it reads the LIVE snapshot rather than the workspace: the question is about the project,
   * not about what is staged. "Not created yet" is not a warning — a model authored today
   * has produced nothing.
   */
  private renderModelSync(model: ModelTemplate): TemplateResult {
    if (this.live === null) return html``;
    const state = modelSyncState(model, this.live.types);
    if (state === 'absent') return html`<span class="chip" title=${this.tr(MSG.syncAbsentHint)}>${this.tr(MSG.syncAbsent)}</span>`;
    if (state === 'synced') return html`<span class="chip new" title=${this.tr(MSG.syncedHint)}>✓ ${this.tr(MSG.synced)}</span>`;
    return html`<span class="chip update" title=${this.tr(MSG.divergedHint)}>⚠ ${this.tr(MSG.diverged)}</span>`;
  }

  /**
   * The catalogs one model reads, on its row — mirrored ones marked.
   *
   * A catalog that is no longer in the project is named by its id rather than dropped:
   * "this model reads something that is gone" is the whole reason to look at this line.
   */
  private renderModelRowSources(model: ModelTemplate): TemplateResult {
    const sources = modelSources(model);
    if (sources.length === 0) return html`<span class="soft small">${this.tr(MSG.modelNoSource)}</span>`;
    return html`
      <span class="model-row-books">
        ${sources.map((source) => {
          const book = this.books.find((candidate) => candidate.id === source.bookId);
          return html`<span class="chip ${book === undefined ? 'conflict' : 'mode'}" title=${book?.name ?? source.bookId}>
            ${book?.name ?? source.bookId}
          </span>`;
        })}
      </span>
    `;
  }

  /**
   * RIGHT: everything about the SELECTED model — its identity, its sources, its
   * structure and its mapping. Creating one comes FIRST (name and description), because
   * the sources and the mirroring choices are decisions ABOUT a model: with no model
   * they would have nowhere to be stored.
   */
  private renderModelDetail(): TemplateResult {
    if (this.modelDraft !== null) return this.renderModelCreate();
    const book = this.activeBook();
    const selected = this.models.find((model) => model.id === this.genModelId);
    return html`
      <section class="browser model-detail">
        <div class="browser-head">
          <span>${selected === undefined ? this.tr(MSG.composerTitle) : selected.name}</span>
          ${selected === undefined ? nothing : html`<span class="chip mode">${selected.typeName}</span>`}
          ${selected === undefined ? nothing : this.renderModelSync(selected)}
          <span class="spacer"></span>
          ${this.renderEditActions(selected, book)}
        </div>
        <div class="composer-scroll">
          ${selected === undefined
            ? html`<div class="empty small">${this.tr(MSG.modelPickHint)}</div>`
            : html`
                ${this.renderModelIdentity()}
                ${this.renderCatalogSources()}
                ${book === null ? html`<div class="form-hint warn-inline">${this.tr(MSG.composerNoCatalog)}</div>` : nothing}
                ${this.renderModelLibrary()}
              `}
        </div>
      </section>
    `;
  }

  /**
   * EDIT / SAVE / CANCEL — a stored model is read-only until it is opened for editing.
   *
   * Why not always-editable: a model is a house standard applied to N machines, and saving
   * it RE-APPLIES it to every instance it already produced (see `onSaveModel`). A stray
   * keystroke in an always-live form would therefore reach the project's datapoints. So
   * the fields are inert until "Edit", every change lives in page state, and "Cancel"
   * restores the stored record by simply re-reading it.
   */
  private renderEditActions(selected: ModelTemplate | undefined, book: AddressBook | null): TemplateResult {
    if (!this.can(EDIT_MODEL)) return html``;
    // EVERY verb of the screen, in one place: which models exist (New / Delete) and what
    // this one contains (Edit / Cancel / Save). They were split between the two columns,
    // which made "the actions" something you had to look for in two places.
    const editing = this.modelEditing && selected !== undefined;
    return html`
      <ix-button variant="secondary" icon="plus" ?disabled=${this.busy} title=${this.tr(MSG.modelNewHint)} @click=${() => this.onNewModel()}>
        ${this.tr(MSG.modelNew)}
      </ix-button>
      <ix-button
        variant="danger-secondary"
        icon="trashcan"
        ?disabled=${this.busy || selected === undefined}
        title=${this.tr(MSG.modelDeleteHint)}
        @click=${() => void this.onDeleteModel(this.genModelId)}
      >
        ${this.tr(MSG.modelDelete)}
      </ix-button>
      ${editing
        ? html`
            <ix-button variant="secondary" ?disabled=${this.busy} @click=${() => this.onCancelModelEdit(selected as ModelTemplate)}>
              ${this.tr(MSG.cancel)}
            </ix-button>
            <ix-button
              variant="primary"
              ?disabled=${this.busy || this.genTypeName.trim() === ''}
              title=${this.tr(MSG.modelSaveHint)}
              @click=${() => void this.onSaveModel(book)}
            >
              ${this.tr(MSG.modelSave)}
            </ix-button>
          `
        : html`<ix-button
            variant="primary"
            icon="pen"
            ?disabled=${this.busy || selected === undefined}
            @click=${() => (this.modelEditing = true)}
          >
            ${this.tr(MSG.modelEdit)}
          </ix-button>`}
    `;
  }

  /** Drop the edits by re-reading the stored model — no second copy to keep in step. */
  private onCancelModelEdit(selected: ModelTemplate): void {
    this.modelEditing = false;
    this.onLoadModel(selected.id);
    this.notice = this.tr(MSG.modelEditCancelled, { name: selected.name });
  }

  /** May the model's fields be changed right now? (Creating one counts as editing.) */
  private editingModel(): boolean {
    return this.can(EDIT_MODEL) && (this.modelEditing || this.modelDraft !== null);
  }

  /**
   * The CREATION form: the name, the description, then the source catalogs and, per
   * catalog, whether it mirrors — everything a model needs, ASKED AT ONCE.
   *
   * It was two steps for one release (create empty, then pick the sources in the detail
   * column) and that split a single decision across two screens: the sources and their
   * mirror flags are chosen when a model is conceived, not later. Nothing is stored until
   * "Create", so an abandoned form leaves no half-model in the list.
   */
  private renderModelCreate(): TemplateResult {
    const draft = this.modelDraft ?? { name: '', description: '' };
    // The type the model will target: the picked one as-is, else one derived from the name.
    const picked = (draft.fromType ?? '').trim();
    const target = picked === '' ? sanitizeSegment(draft.name.trim()) : picked;
    return html`
      <section class="browser model-detail">
        <div class="browser-head"><span>${this.tr(MSG.modelCreateTitle)}</span></div>
        <div class="composer-scroll">
          <label class="gen-row"><span>${this.tr(MSG.modelName)}</span>
            <ix-input
              placeholder="STD_Four"
              .value=${draft.name}
              @valueChange=${(event: CustomEvent<string>) => this.patchModelDraft({ name: String(event.detail) })}
            ></ix-input></label>
          <div class="gen-hint">
            ${target === '' ? this.tr(MSG.modelNameRequired) : this.tr(MSG.modelTypeWillBe, { type: target })}
          </div>
          <label class="gen-row gen-row-tall"><span>${this.tr(MSG.modelDescription)}</span>
            <textarea
              class="model-desc"
              rows="3"
              placeholder=${this.tr(MSG.modelDescriptionPlaceholder)}
              .value=${draft.description}
              @input=${(event: Event) => this.patchModelDraft({ description: (event.target as HTMLTextAreaElement).value })}
            ></textarea></label>
          <label class="gen-row"><span>${this.tr(MSG.modelFromType)}</span>
            <ix-select
              .value=${draft.fromType ?? ''}
              @valueChange=${(event: CustomEvent<string | string[]>) => this.patchModelDraft({ fromType: firstOf(event.detail) })}
            >
              <ix-select-item value="" label=${this.tr(MSG.modelFromTypeNone)}></ix-select-item>
              ${this.dpTypes.map((typeName) => html`<ix-select-item value=${typeName} label=${typeName}></ix-select-item>`)}
            </ix-select></label>
          <div class="form-hint">${this.tr(MSG.modelFromTypeHint)}</div>
          ${this.renderCatalogSources()}
          <div class="gen-row gen-model-actions">
            <span></span>
            <ix-button variant="secondary" ?disabled=${this.busy} @click=${() => (this.modelDraft = null)}>
              ${this.tr(MSG.cancel)}
            </ix-button>
            <ix-button variant="primary" icon="plus" ?disabled=${this.busy || target === ''} @click=${() => void this.onCreateModel()}>
              ${this.tr(MSG.modelCreate)}
            </ix-button>
          </div>
        </div>
      </section>
    `;
  }

  /** The selected model's IDENTITY: what it is called and what it is for. */
  private renderModelIdentity(): TemplateResult {
    return html`
      <label class="gen-row"><span>${this.tr(MSG.modelName)}</span>
        <ix-input
          .value=${this.genModelName}
          ?disabled=${!this.editingModel()}
          @valueChange=${(event: CustomEvent<string>) => (this.genModelName = String(event.detail))}
        ></ix-input></label>
      <label class="gen-row"><span>${this.tr(MSG.modelTargetType)}</span>
        <ix-input
          .value=${this.genTypeName}
          ?disabled=${!this.editingModel()}
          @valueChange=${(event: CustomEvent<string>) => (this.genTypeName = String(event.detail))}
        ></ix-input></label>
      <div class="form-hint">
        ${this.dpTypes.includes(this.genTypeName.trim())
          ? this.tr(MSG.modelTargetExisting, { type: this.genTypeName.trim() })
          : this.tr(MSG.modelTargetNew, { type: sanitizeSegment(this.genTypeName.trim()) })}
      </div>
      <label class="gen-row gen-row-tall"><span>${this.tr(MSG.modelDescription)}</span>
        <textarea
          class="model-desc"
          rows="2"
          placeholder=${this.tr(MSG.modelDescriptionPlaceholder)}
          ?disabled=${!this.editingModel()}
          .value=${this.genDescription}
          @input=${(event: Event) => (this.genDescription = (event.target as HTMLTextAreaElement).value)}
        ></textarea></label>
    `;
  }

  private patchModelDraft(patch: { name?: string; description?: string; fromType?: string }): void {
    this.modelDraft = { ...(this.modelDraft ?? { name: '', description: '' }), ...patch };
  }

  /**
   * The model's SOURCE catalOGS — one or several.
   *
   * A model may read more than one: two TIA DBs of the same PLC, or a TIA export
   * alongside the OPC UA browse of the same machine. The first checked one is the
   * PRIMARY (it answers for mirroring and for the mode of an unqualified binding);
   * the others contribute their signals to the mapping, each leaf keeping the
   * interface of the catalog it came from — so every address is written through the
   * driver of ITS OWN source (see the core's per-leaf resolution).
   */
  private renderCatalogSources(): TemplateResult {
    return html`
      <div class="gen-row"><span>${this.tr(MSG.composerCatalog)}</span><span></span></div>
      <div class="box-list source-list">
        ${this.books.map((candidate) => {
          const checked = this.selectedBookId === candidate.id || this.extraBookIds.has(candidate.id);
          const primary = this.selectedBookId === candidate.id;
          return html`<div class="box source-box">
            <label class="source-use" title=${candidate.name}>
              <input
                type="checkbox"
                ?disabled=${!this.editingModel()}
                .checked=${checked}
                @change=${() => this.toggleSourceBook(candidate.id)}
              />
              <span class="box-name">${candidate.name}</span>
            </label>
            <span class="chip">${this.tr(MSG.entriesChip, { n: candidate.entries.length })}</span>
            ${primary ? html`<span class="chip mode">${this.tr(MSG.sourcePrimary)}</span>` : nothing}
            <span class="spacer"></span>
            <ix-icon-button
              size="16"
              variant="secondary"
              icon="import"
              ?disabled=${!checked || this.busy || !this.editingModel()}
              a11y-label=${this.tr(MSG.sourceMirrorAction)}
              title=${this.tr(MSG.sourceMirrorHint)}
              @click=${() => this.onMirrorSource(candidate)}
            ></ix-icon-button>
            <ix-icon-button
              size="16"
              variant="secondary"
              icon="link-break"
              ?disabled=${!checked || this.busy || !this.editingModel()}
              a11y-label=${this.tr(MSG.sourceRemoveAction)}
              title=${this.tr(MSG.sourceRemoveHint)}
              @click=${() => this.onRemoveSource(candidate)}
            ></ix-icon-button>
          </div>`;
        })}
      </div>
      <div class="form-hint">${this.tr(MSG.sourceHint)}</div>
    `;
  }

  /**
   * UPDATE THE MODEL BY MIRRORING one catalog — an action, not a stored flag.
   *
   * It was a per-catalog checkbox for one release, which made "the model mirrors this
   * catalog" look like a permanent property: it is not, since the branches can then be
   * renamed, re-mapped or deleted by hand. Pressing it MERGES the catalog's paths into the
   * structure already there (`mirrorIntoStructure`) and brings every new leaf bound to the
   * signal it came from — that is the automatic mapping, done by construction rather than
   * by a name-matching pass afterwards.
   *
   * What is already in the model WINS: a branch an engineer renamed or re-mapped is left
   * alone and counted in the notice, so re-mirroring after a catalog was re-browsed adds
   * what is new without undoing anyone's work.
   */
  private onMirrorSource(book: AddressBook): void {
    const typeName = this.genTypeName.trim() || 'Type';
    const base = { structure: parseStructureOutline(this.genOutline, typeName).structure, bindings: this.genBindings };
    const mirror = mirrorIntoStructure(base, { book, selection: this.visibleSignals(book).map((entry) => entry.path) }, { typeName });
    const added = Object.keys(mirror.bindings).length - Object.keys(this.genBindings).length;
    this.genOutline = formatStructureOutline(mirror.structure);
    this.genOutlineErrors = parseStructureOutline(this.genOutline, typeName).errors;
    this.genBindings = mirror.bindings;
    this.genAmbiguous = [];
    this.genWarnings = mirror.warnings;
    this.notice = this.tr(MSG.mirrorDone, { name: book.name, branches: Math.max(added, 0) });
  }

  /**
   * REMOVE a catalog from the model — the counterpart of the ⟱ button beside it.
   *
   * Un-ticking a source only stopped offering its signals: the branches it had contributed
   * stayed, bound to a catalog the model no longer read. This drops them together (the core's
   * `removeSourceFromModel` decides from the BINDINGS, so a branch re-mapped elsewhere
   * stays), and un-ticks the source in the same gesture.
   */
  private onRemoveSource(book: AddressBook): void {
    const typeName = this.genTypeName.trim() || 'Type';
    const cleaned = removeSourceFromModel(
      { structure: parseStructureOutline(this.genOutline, typeName).structure, bindings: this.genBindings, policy: this.genPolicy },
      book.id
    );
    this.genOutline = formatStructureOutline(cleaned.structure);
    this.genOutlineErrors = parseStructureOutline(this.genOutline, typeName).errors;
    this.genBindings = cleaned.bindings;
    this.genPolicy = cleaned.policy;
    this.genAmbiguous = [];
    // Drop it from the sources too: "remove the catalog from the model" is one decision, and
    // leaving it checked would keep offering the signals of a catalog it no longer reads.
    if (this.selectedBookId === book.id || this.extraBookIds.has(book.id)) this.toggleSourceBook(book.id);
    this.notice = this.tr(MSG.sourceRemoveDone, { name: book.name, n: cleaned.removed.length });
  }

  /**
   * Check / uncheck a source catalog.
   *
   * The FIRST one checked is the primary (`selectedBookId`) because everything that
   * cannot be per-leaf needs one: what "mirror the catalog" mirrors, and the mode of a
   * binding that names no catalog. Unchecking it promotes another rather than leaving
   * the model without a primary.
   */
  private toggleSourceBook(bookId: string): void {
    if (this.selectedBookId === bookId) {
      const promoted = [...this.extraBookIds][0];
      const rest = new Set(this.extraBookIds);
      if (promoted !== undefined) rest.delete(promoted);
      this.selectedBookId = promoted ?? null;
      this.extraBookIds = rest;
      return;
    }
    const extras = new Set(this.extraBookIds);
    if (extras.has(bookId)) extras.delete(bookId);
    else if (this.selectedBookId === null) this.selectedBookId = bookId;
    else extras.add(bookId);
    this.extraBookIds = extras;
  }

  /** The catalogs a model reads: the primary first, then the extras, in book order. */
  private sourceBooks(): AddressBook[] {
    const primary = this.activeBook();
    const extras = this.books.filter((book) => this.extraBookIds.has(book.id) && book.id !== primary?.id);
    return primary === null ? extras : [primary, ...extras];
  }

  /**
   * The signals a mapping may bind to — EVERY one qualified `catalogue::chemin`.
   *
   * Always, the first catalog included. A mapping then says which catalog it reads
   * without depending on which source happens to be first, so re-ordering the sources or
   * promoting another one cannot change what a branch points at. (Models written before
   * this convention hold bare paths; the core still resolves those against the model's own
   * book — see `parseBindingRef` — so they keep working, they simply stop being produced.)
   */
  private sourceEntries(): BookEntry[] {
    // MEMOISED: this is called on every render, and qualifying 331 entries × N renders was
    // measurable on a real catalog. The key is what the result depends on — which books are
    // checked, and the role filter that hides signals — so a change still invalidates it.
    const key = `${this.sourceBooks().map((book) => book.id).join('|')}#${this.roleFilter}`;
    if (this.entryCacheKey === key) return this.entryCache;
    const entries = this.sourceBooks().flatMap((book) =>
      this.visibleSignals(book).map((entry) => ({ ...entry, path: bindingRef(book.id, entry.path) }))
    );
    this.entryCacheKey = key;
    this.entryCache = entries;
    return entries;
  }

  /**
   * Open the CREATION form. Nothing is stored until "Create".
   *
   * The source selection is RESET, so the form starts from no catalog instead of
   * inheriting the ones the previously selected model happened to read — a new model
   * silently pre-bound to another one's catalogs is the kind of default that gets saved
   * without being noticed.
   */
  private onNewModel(): void {
    this.modelDraft = { name: '', description: '' };
    this.genModelId = '';
    this.genModelName = '';
    this.selectedBookId = null;
    this.extraBookIds = new Set();
    this.genOutline = '';
    this.genOutlineErrors = [];
    this.genBindings = {};
    this.genPolicy = {};
    this.genAmbiguous = [];
    this.genWarnings = [];
  }

  /**
   * Create the model from the whole form: its identity, its source catalogs, and the
   * structure MIRRORED from the ones marked so.
   *
   * The id is derived from the name once (`templateIdFrom`), so re-creating the same name
   * edits that model instead of quietly producing a second one with the same type.
   */
  private async onCreateModel(): Promise<void> {
    const draft = this.modelDraft;
    if (draft === null) return;
    const name = draft.name.trim();
    // Picking an existing DP type means PARAMETERISING it: the model targets that type, so its
    // name is the type's, not one derived from the model's label — otherwise generating would
    // create a second type beside the one the operator chose.
    const chosen = (draft.fromType ?? '').trim();
    const typeName = chosen === '' ? sanitizeSegment(name) : chosen;
    if (typeName === '') return;
    // Three ways a structure gets here, in order of precedence: an EXISTING DP type picked
    // in the form (read from the project, mappings left empty — the branches exist, what they
    // read is the next decision), whatever "Mirror this catalog" already built on screen, or
    // an empty type.
    let structure = parseStructureOutline(this.genOutline, typeName).structure;
    let bindings = this.genBindings;
    if (chosen !== '') {
      try {
        const existing = await this.gateway.readDpType(chosen);
        // The type's own MEMBERS as the model's first level (`dpTypeStructureAsModel`): the type
        // is the root, not an element — a reader that keeps it as a child produced a first-level
        // element named after the DP type, with everything real buried under it.
        structure = dpTypeStructureAsModel(existing.structure, typeName);
        bindings = {};
      } catch (error) {
        this.notice = this.tr(MSG.modelFromTypeFailed, { type: chosen, error: (error as Error).message });
        return;
      }
    }
    const model: ModelTemplate = {
      id: templateIdFrom(name === '' ? typeName : name),
      name: name === '' ? typeName : name,
      ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
      typeName,
      structure,
      bindings,
      ...(this.selectedBookId === null ? {} : { sourceBookId: this.selectedBookId }),
      sources: this.sourceBooks().map((book) => ({ bookId: book.id }))
    };
    this.busy = true;
    try {
      const stored = await this.gateway.saveModel(model);
      this.models = await this.gateway.listModels();
      this.modelDraft = null;
      this.onLoadModel(stored.id);
      // Straight into edit mode: a model is created to be filled in, and asking for
      // "Edit" one click after "Create" would be ceremony.
      this.modelEditing = true;
      this.notice = this.tr(MSG.modelCreated, { name: stored.name });
    } catch (error) {
      this.notice = this.tr(MSG.modelSaveFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * The selected model's CONTENT: its structure, with each branch's mapping and its
   * deployment — then "update".
   *
   * Reduced on purpose. The column used to carry, above the tree, a tree/text view
   * toggle, an "auto-map" button, a mapped counter and TWO explanatory paragraphs, then a
   * coverage sentence under it: five pieces of chrome around the one thing being edited.
   * What is left is a single status line (mapped count + the two actions that change it)
   * and the tree. The outline text view went with them; it stays the storage format, and
   * `formatStructureOutline` still round-trips it for the model store.
   */
  private renderModelLibrary(): TemplateResult {
    const parsed = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type');
    const leaves = structureLeaves(parsed.structure);
    // Counted against THIS catalog, not merely "has a binding": a model carries paths into
    // the catalog it was authored on, and calling those "mapped" while none resolve here
    // would read as a contradiction.
    const paths = new Set(this.sourceEntries().map((entry) => entry.path));
    const bound = leaves.filter((leaf) => paths.has(this.genBindings[leaf.segments.join('.')] ?? '')).length;
    return html`
      <div class="gen-views">
        <span class="soft small">${this.tr(MSG.mappedCount, { n: bound, total: leaves.length })}</span>
      </div>
      ${this.genOutlineErrors.length > 0
        ? html`<ul class="gen-warnings warn-inline">${this.genOutlineErrors.map((error) => html`<li>${this.warnText(error)}</li>`)}</ul>`
        : nothing}
      ${this.renderStructureTree(parsed.structure)}
      ${this.genWarnings.length > 0
        ? html`<ul class="gen-warnings">${this.genWarnings.map((w) => html`<li>${this.warnText(w)}</li>`)}</ul>`
        : nothing}
    `;
  }

  /** The equipment the generation targets (the picked one, else the selected one). */
  private targetDevice(): Device | undefined {
    return this.devices.find((device) => device.id === (this.genTargetId || this.selectedDeviceId));
  }

  /** Does this equipment reference that catalog? A model applied elsewhere is a warning. */
  private deviceServesBook(device: Device, bookId: string | null): boolean {
    return bookId === null || device.bookIds.includes(bookId);
  }

  /**
   * A NEW INSTANCE, as a row of the tree — not a form.
   *
   * An instance is a datapoint on an equipment, so declaring one asks for exactly that:
   * the name(s) and the equipment, on the line where the instances live, validated by the
   * check on the right. The boxed "Generate the model from this book" panel this replaces
   * asked for four more things the model already answers (its type, its structure mode,
   * its catalog, its policy).
   */
  private renderInstanceDraftRow(model: ModelTemplate): TemplateResult {
    const target = this.targetDevice();
    return html`
      <div class="tree-row tree-instance tree-instance-draft">
        <span class="tree-indent"></span>
        <ix-input
          class="instance-name"
          placeholder="FOUR001, FOUR002"
          .value=${this.genEquipments}
          @valueChange=${(event: CustomEvent<string>) => (this.genEquipments = String(event.detail))}
        ></ix-input>
        <ix-select
          class="instance-device"
          .value=${target?.id ?? ''}
          @valueChange=${(event: CustomEvent<string | string[]>) => (this.genTargetId = firstOf(event.detail))}
        >
          ${this.devices.map(
            (device) => html`<ix-select-item value=${device.id} label="${device.name} · ${this.protocolLabel(device)}"></ix-select-item>`
          )}
        </ix-select>
        <ix-icon-button
          size="16"
          variant="primary"
          icon="check"
          a11y-label=${this.tr(MSG.instanceCreate)}
          title=${this.tr(MSG.instanceCreate)}
          ?disabled=${this.busy || !this.can(EDIT_MODEL) || target === undefined || this.genEquipments.trim() === ''}
          @click=${() => void this.onCreateInstance(model)}
        ></ix-icon-button>
        <ix-icon-button
          size="16"
          variant="tertiary"
          icon="close"
          a11y-label=${this.tr(MSG.cancel)}
          title=${this.tr(MSG.cancel)}
          ?disabled=${this.busy}
          @click=${() => (this.instanceFormType = null)}
        ></ix-icon-button>
      </div>
      ${target === undefined || this.deviceServesBook(target, modelSources(model)[0]?.bookId ?? null)
        ? nothing
        : html`<div class="gen-hint warn-inline">${this.tr(MSG.genTargetNotServed, { name: target.name })}</div>`}
      ${this.genWarnings.length > 0
        ? html`<ul class="gen-warnings">${this.genWarnings.map((w) => html`<li>${this.warnText(w)}</li>`)}</ul>`
        : nothing}
    `;
  }

  /**
   * Instantiate a STORED model on the chosen equipment.
   *
   * It reads the model, not the editor: the sources come from the record
   * (`modelSources`), so instantiating never depends on what happens to be open in the
   * Model tab — and a model whose primary catalog is gone fails with that as the reason
   * instead of silently generating a type with no address.
   */
  private async onCreateInstance(model: ModelTemplate): Promise<void> {
    const sources = modelSources(model)
      .map((source) => this.books.find((book) => book.id === source.bookId))
      .filter((book): book is AddressBook => book !== undefined);
    const [primary, ...extras] = sources;
    if (primary === undefined) {
      this.genWarnings = [{ code: 'ui.model-no-catalog', message: this.tr(MSG.modelNoSource) }];
      return;
    }
    await this.runGeneration({
      book: primary,
      extras,
      typeName: model.typeName,
      mapping: { structure: model.structure, bindings: model.bindings },
      policy: model.policy ?? {}
    });
    this.instanceFormType = null;
  }

  /**
   * Merge one leaf's policy change — field by field, so pinning an archive group
   * keeps the default alarm. `{ range: undefined }` is the tree's way of CLEARING a
   * range (both bounds are needed for one to mean anything), so the key is dropped
   * rather than stored as an explicit `undefined`.
   */
  private patchPolicy(path: string, patch: LeafPolicy): void {
    const current = this.genPolicy[path];
    const next: LeafPolicy = current === undefined ? { ...patch } : { ...current, ...patch };
    if (patch.range === undefined && 'range' in patch) delete next.range;
    this.genPolicy = { ...this.genPolicy, [path]: next };
  }

  /** The tree view: shape the type and map each leaf, in one place. */
  /**
   * The ONE component of the Model tab: the models, and inside the selected one, its
   * structure — every leaf carrying its element type, its mapping AND its deployment
   * (alarm / archive / range).
   *
   * It replaced three stacked widgets (a model list, a structure tree, a policy
   * table) that between them asked one question in three places, with the leaf's
   * dotted path as the only link between them.
   */
  private renderStructureTree(structure: DpTypeStructure | null): TemplateResult {
    return html`
      <wui-eng-structure-tree
        .structure=${structure}
        .entries=${this.sourceEntries()}
        .bindings=${this.genBindings}
        .ambiguous=${this.genAmbiguous}
        .policy=${this.genPolicy}
        .alarmClasses=${this.configOptions.alarmClasses}
        .archiveGroups=${this.configOptions.archiveGroups}
        .subscriptions=${this.configOptions.subscriptions}
        .pollGroups=${this.configOptions.pollGroups}
        .canEdit=${this.editingModel()}
        .uiLang=${this.uiLang}
        @wui:treechange=${(event: CustomEvent<StructureChangeDetail>) => this.onStructureChange(event.detail)}
        @wui:treebind=${(event: CustomEvent<StructureBindDetail>) => this.onBind(event.detail.leaf, event.detail.entryPath)}
        @wui:policychange=${(event: CustomEvent<PolicyChangeDetail>) => this.patchPolicy(event.detail.leaf, event.detail.patch)}
        @wui:pickdp=${(event: CustomEvent<DpPickRequest>) => void this.openDpPick(event.detail)}
      ></wui-eng-structure-tree>
    `;
  }

  /**
   * A tree edit lands back in the OUTLINE, which stays the single source of truth —
   * so the text view is never stale, and the generator keeps reading one value.
   *
   * The bindings come back with the structure because the core re-keyed them: renaming
   * a group moves every mapping under it, and dropping a node drops its own.
   */
  private onStructureChange(detail: StructureChangeDetail): void {
    this.genOutline = formatStructureOutline(detail.structure);
    this.genOutlineErrors = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type').errors;
    this.genBindings = detail.bindings;
    // An ambiguity is about a leaf PATH; a rename or a deletion invalidates the ones
    // it moved, and re-running the auto-binding is what recomputes them honestly.
    this.genAmbiguous = this.genAmbiguous.filter((item) => (detail.bindings[item.leaf] ?? '') === '');
  }

  /**
   * Open a saved model in the detail column: its type name, its structure, its mappings
   * and its policy. The equipment names and the target are NOT touched — they are what
   * differs between two applications of the same model.
   */
  private onLoadModel(id: string): void {
    this.genModelId = id;
    this.modelDraft = null;
    const model = this.models.find((candidate) => candidate.id === id);
    if (model === undefined) return;
    this.genTypeName = model.typeName;
    this.genModelName = model.name;
    this.genDescription = model.description ?? '';
    this.genOutline = formatStructureOutline(model.structure);
    this.genOutlineErrors = parseStructureOutline(this.genOutline, model.typeName).errors;
    // MIGRATION on open: a model saved before bindings were always qualified holds bare
    // paths. They are re-qualified against its primary catalog, so its mapping shows as
    // mapped (and is stored qualified the next time it is saved) instead of reading
    // "not mapped" against a signal list where every option now names its catalog.
    const primaryId = modelSources(model)[0]?.bookId;
    this.genBindings = Object.fromEntries(
      Object.entries(model.bindings).map(([leaf, binding]) => {
        if (binding === '' || parseBindingRef(binding).bookId !== undefined || primaryId === undefined) return [leaf, binding];
        return [leaf, bindingRef(primaryId, binding)];
      })
    );
    // The deployment decisions travel WITH the model — that is what makes a
    // second instance a replay instead of a re-decision.
    this.genPolicy = model.policy === undefined ? {} : { ...model.policy };
    this.genAmbiguous = [];
    this.genWarnings = [];
    // The model's own catalogs become the checked sources — including which of them it
    // MIRRORS, so re-opening a model shows the choices it was built with rather than the
    // ones left over from the previously selected one.
    const sources = modelSources(model);
    this.selectedBookId = sources[0]?.bookId ?? this.selectedBookId;
    this.extraBookIds = new Set(sources.slice(1).map((source) => source.bookId));
    this.notice = this.tr(MSG.modelLoaded, { name: model.name, type: model.typeName });
  }

  /** Store the model being edited: its identity, its sources, its structure and mapping. */
  private async onSaveModel(book: AddressBook | null): Promise<void> {
    // The TYPE is sanitised (it is a WinCC OA identifier); the NAME is a label and is left
    // exactly as typed. An existing type therefore stays the target, spelling included.
    const typeName = sanitizeSegment(this.genTypeName.trim());
    if (typeName === '') return;
    const modelName = this.genModelName.trim() === '' ? typeName : this.genModelName.trim();
    const structure = parseStructureOutline(this.genOutline, typeName).structure;
    const description = this.genDescription.trim();
    const model: ModelTemplate = {
      id: this.genModelId || templateIdFrom(modelName),
      name: modelName,
      ...(description === '' ? {} : { description }),
      typeName,
      structure,
      bindings: this.genBindings,
      ...(Object.keys(this.genPolicy).length === 0 ? {} : { policy: this.genPolicy }),
      // A model with NO catalog is legitimate — a structure imported from a DP type, or one
      // authored by hand, is worth storing before anything is mapped. The primary is written
      // only when there is one, so a saved model never claims a source it does not read.
      ...(book === null ? {} : { sourceBookId: book.id }),
      // Every catalog it reads AND which of them shape it — the mirroring choice has to
      // survive a reload, otherwise re-opening the model would offer to rebuild a
      // structure it can no longer tell it already built.
      sources: this.sourceBooks().map((candidate) => ({ bookId: candidate.id }))
    };
    this.busy = true;
    try {
      const stored = await this.gateway.saveModel(model);
      this.models = await this.gateway.listModels();
      this.genModelId = stored.id;
      // Saved means DONE: back to read-only, so Save/Cancel give way to Edit. Leaving the
      // editor open after a save invites a second, unintended round of changes on a model
      // that has just been re-applied to every one of its instances.
      this.modelEditing = false;
      this.notice = this.tr(MSG.modelSaved, { name: stored.name });
      this.busy = false;
      // A model change must REACH what the model already produced: saving it
      // re-applies the new structure/mappings/policy to every existing instance, in
      // the WORKSPACE (nothing is written to the project — the Instances tree then
      // shows them as "to update", which is the truth until a check-in).
      if (this.workspace !== null && instanceTargets(this.workspace, stored.typeName).length > 0) {
        await this.onReapplyModel(stored);
      }
    } catch (error) {
      this.notice = this.tr(MSG.modelSaveFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  private async onDeleteModel(id: string): Promise<void> {
    const name = this.models.find((model) => model.id === id)?.name ?? id;
    this.busy = true;
    try {
      await this.gateway.deleteModel(id);
      this.models = await this.gateway.listModels();
      if (this.genModelId === id) this.genModelId = '';
      this.notice = this.tr(MSG.modelDeleted, { name });
    } catch (error) {
      this.notice = this.tr(MSG.modelSaveFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  private onBind(leafPath: string, entryPath: string): void {
    this.genBindings = { ...this.genBindings, [leafPath]: entryPath };
    this.genAmbiguous = this.genAmbiguous.filter((item) => item.leaf !== leafPath);
  }

  /**
   * Name-match the authored leaves onto the book, and keep what it could not decide.
   *
   * The matches are QUALIFIED with the book they came from, like every other binding the
   * page produces: the core name-matches on paths, so the qualification is added after.
   */
  private onAutoBind(book: AddressBook): void {
    const { structure } = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type');
    const result = autoBindStructure(structure, this.visibleSignals(book));
    const qualified = Object.fromEntries(
      Object.entries(result.bindings).map(([leaf, path]) => [leaf, path === '' ? '' : bindingRef(book.id, path)])
    );
    // Keep the operator's own choices: auto-binding fills the gaps, it does not reset.
    this.genBindings = { ...qualified, ...this.genBindings };
    this.genAmbiguous = result.ambiguous.filter((item) => (this.genBindings[item.leaf] ?? '') === '');
    const bound = Object.values(this.genBindings).filter((value) => value !== '').length;
    this.notice = this.tr(MSG.autoBindDone, { bound, unbound: result.unbound.length, ambiguous: result.ambiguous.length });
  }


  /**
   * Run the generator, merge into the workspace and refresh the plan.
   *
   * One place for it, two callers: instantiating a stored model (the Instances tab) and
   * the demo/screenshot harness, which generates straight from the editor's state. The
   * arguments are what those two disagree about — everything else is the same run.
   */
  private async runGeneration(input: {
    book: AddressBook;
    extras?: AddressBook[];
    typeName: string;
    mapping?: ModelMapping;
    policy?: ModelPolicy;
  }): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    const book = input.book;
    // The TARGET, explicitly — see renderInstanceDraftRow. Applying a model is a choice,
    // not a side effect of whichever equipment happens to be selected elsewhere.
    const device = this.targetDevice();
    const equipments = this.genEquipments
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    this.busy = true;
    try {
      const extras = input.extras ?? [];
      const policy = input.policy ?? {};
      // No zone segment: the studio names the datapoints after the equipment alone
      // (the core still accepts an optional `zone` for callers that want one).
      const proposal = generateModelFromBook(book, {
        typeName: input.typeName,
        equipments,
        deviceId: device?.id ?? book.id,
        // The TARGET equipment's own connection first, the catalog's only as a fallback.
        // A book names the server it was BROWSED on; that is the same thing right up to the
        // moment the catalog is mutualised, and from then on the browse connection would
        // address every instance to the machine the catalog came from.
        bindConnection: connectionNameOf(device) ?? book.interface?.connection,
        // The book's own interface first; else the device's protocol — the access
        // mode follows the protocol since the checkboxes were removed.
        mode: book.interface?.protocol ?? device?.protocol ?? device?.accessModes[0],
        // With no mapping the core mirrors the book itself (what the demo harness uses);
        // a model always brings its authored structure and its bindings.
        ...(input.mapping === undefined ? {} : { mapping: input.mapping }),
        // The OTHER source catalogs of a multi-catalog model: their signals are bound
        // by a QUALIFIED reference, and each leaf keeps its own catalog's interface,
        // so an address is written through the driver of the source it came from.
        ...(extras.length === 0 ? {} : { books: extras }),
        // The deployment decisions (alarm / archive / range) — what the model
        // pinned once; the core fills every unpinned leaf with its default.
        ...(Object.keys(policy).length === 0 ? {} : { policy }),
        // …and the unpinned defaults name the PROJECT's group and class, not the core's tokens.
        profileContext: this.projectProfileContext()
      });
      const merged = mergeProposal(workspace, proposal);
      await this.gateway.saveWorkspace(merged);
      this.workspace = merged;
      // Re-read live with the WIDER scope the generated model just introduced.
      this.live = await this.gateway.liveSnapshot(this.liveScope(merged));
      this.recomputePlan();
      this.genWarnings = proposal.warnings;
      const configCount = Object.keys(proposal.configs).length;
      this.notice = this.tr(MSG.genDone, { type: proposal.type.typeName, dps: proposal.dps.length, configs: configCount });
    } catch (error) {
      this.genWarnings = [
        { code: 'ui.generation-failed', message: this.tr(MSG.genFailed, { error: (error as Error).message }) }
      ];
    } finally {
      this.busy = false;
    }
  }


  private renderGridRow(row: GridRow): TemplateResult {
    const cfg = row.configs;
    return html`
      <tr>
        <td class="mono dpe">${row.dpe}</td>
        <td>${row.leafType}</td>
        <td class="mono addr ${cfg.address?.active === false ? 'soft' : ''}">${cfg.address?.reference ?? html`<span class="soft">—</span>`}</td>
        <td>
          ${cfg.address ? dirLabel(cfg.address.direction) : ''}${cfg.address?.historical === true
            ? html`<span class="chip hist" title=${this.tr(MSG.addressHistorical)}>H</span>`
            : nothing}
        </td>
        <td>${cfg.alarm ? html`<span class="chip update">${cfg.alarm.kind}</span>` : html`<span class="soft">—</span>`}</td>
        <td>${cfg.archive?.active ? html`<span class="chip new">${cfg.archive.group}</span>` : html`<span class="soft">—</span>`}</td>
        <td>${cfg.range ? html`<span class="mono">${cfg.range.min}‥${cfg.range.max}</span>` : html`<span class="soft">—</span>`}</td>
        <td class="mono live" title=${row.exists ? '' : this.tr(MSG.liveNotYet)}>
          ${row.live === undefined ? html`<span class="soft">--</span>` : String(row.live)}
        </td>
      </tr>
    `;
  }

  // --- panel 4: control / check-in --------------------------------------------

  /**
   * The GLOBAL status: one sentence answering "is everything checked in?".
   *
   * Counted over the INSTANCES rather than over the plan's items, because that is the
   * unit an operator thinks in — "312 configs pending" and "2 machines pending" are
   * the same fact, and only the second one is actionable.
   */
  private renderGlobalStatus(ws: Workspace, plan: EngPlan | null): TemplateResult {
    const instances = this.allInstances(ws, plan);
    const tally = tallyInstances(instances);
    const pending = tally.total - tally.synced;
    if (tally.total === 0) return html``;
    return html`
      <span
        class="chip ${pending === 0 ? 'new' : 'update'}"
        title=${pending === 0 ? this.tr(MSG.statusAllSynced) : this.tr(MSG.statusPending, { n: pending, total: tally.total })}
      >
        ${pending === 0
          ? html`✓ ${this.tr(MSG.statusSynced)} (${tally.total})`
          : this.tr(MSG.statusPending, { n: pending, total: tally.total })}
      </span>
      ${tally.conflict > 0
        ? html`<span class="chip conflict">${this.tr(MSG.statusConflict)} ${tally.conflict}</span>`
        : nothing}
    `;
  }

  /** Every instance of every model of the workspace — the global tally's input. */
  private allInstances(ws: Workspace, plan: EngPlan | null): ModelInstance[] {
    return this.instanceTypeNames(ws).flatMap((typeName) => modelInstances(ws, typeName, plan, this.live));
  }

  /**
   * LEFT of the Instances tab: the models, exactly as the Model tab lists them — name, DP
   * type, and whether the project's type still matches (`renderModelSync`).
   *
   * The same shape on both tabs on purpose: one is "what a model IS", the other "what it
   * PRODUCED", and an engineer should not have to re-learn where to click between them. A
   * generated type nobody saved as a model is listed too, so the tab cannot hide datapoints
   * it is the only screen to show.
   */
  private renderInstanceMaster(ws: Workspace, plan: EngPlan | null): TemplateResult {
    const typeNames = this.instanceTypeNames(ws);
    return html`
      <section class="browser model-master">
        <div class="browser-head">
          <span>${this.tr(MSG.modelLibrary)}</span>
          <span class="chip">${typeNames.length}</span>
        </div>
        <div class="model-master-scroll">
          ${typeNames.length === 0 ? html`<div class="empty small">${this.tr(MSG.instanceNoModel)}</div>` : nothing}
          ${typeNames.map((typeName) => {
            const saved = this.models.find((model) => model.typeName === typeName);
            const tally = tallyInstances(modelInstances(ws, typeName, plan, this.live));
            const active = this.instanceModelType === typeName || (this.instanceModelType === '' && typeName === typeNames[0]);
            return html`
              <button class="model-row ${active ? 'active' : ''}" @click=${() => (this.instanceModelType = typeName)}>
                <span class="mono model-row-name">${saved?.name ?? typeName}</span>
                <span class="chip mode">${typeName}</span>
                <span class="chip">${this.tr(MSG.instancesOfModel, { n: tally.total })}</span>
                <!-- ONE verdict about the type. The plan's chip and the sync chip answer the same
                     question from two sources, so only one is shown: the plan when it has
                     something pending on the type, the project comparison otherwise. -->
                ${this.renderTypeVerdict(typeName, plan, saved)}
              </button>
            `;
          })}
        </div>
      </section>
    `;
  }

  /**
   * RIGHT of the Instances tab: the selected model's instances, each with its status, and
   * under each one the DPEs it carries.
   *
   * The DPE rows are what makes a status actionable: "diverged" on a datapoint says nothing
   * about WHICH element differs, and the address / alarm / archive / range cells beside each
   * DPE are exactly the answer. The per-model verbs live here too — new instance, re-apply
   * this model, and (armed) re-create it.
   */
  private renderInstanceDetail(ws: Workspace, plan: EngPlan | null): TemplateResult {
    const typeNames = this.instanceTypeNames(ws);
    const typeName = this.instanceModelType === '' ? typeNames[0] : this.instanceModelType;
    if (typeName === undefined) return html`<section class="browser model-detail"></section>`;
    const saved = this.models.find((model) => model.typeName === typeName);
    const instances = modelInstances(ws, typeName, plan, this.live);
    return html`
      <section class="browser model-detail">
        <div class="browser-head">
          <span class="mono">${typeName}</span>
          ${this.renderTypeVerdict(typeName, plan, saved)}
          <span class="spacer"></span>
          ${saved === undefined || !this.can(EDIT_MODEL)
            ? nothing
            : html`
                <ix-button variant="secondary" icon="plus" ?disabled=${this.busy} title=${this.tr(MSG.instanceNewHint)} @click=${() => this.openInstanceForm(typeName)}>
                  ${this.tr(MSG.instanceNew)}
                </ix-button>
                <ix-button
                  variant="secondary"
                  icon="refresh"
                  ?disabled=${this.busy || instances.length === 0}
                  title=${this.tr(MSG.reapplyHint)}
                  @click=${() => void this.onReapplyModel(saved)}
                >
                  ${this.tr(MSG.reapplyModel)}
                </ix-button>
                <ix-button
                  variant="danger-secondary"
                  icon="trashcan"
                  ?disabled=${this.busy || instances.length === 0}
                  title=${this.tr(this.recreateArmed === typeName ? MSG.recreateConfirm : MSG.recreateHint)}
                  @click=${() => void this.onRecreate(typeName)}
                >
                  ${this.tr(this.recreateArmed === typeName ? MSG.recreateArmed : MSG.recreate)}
                </ix-button>
              `}
          ${this.can('checkin')
            ? html`<ix-button
                variant="primary"
                icon="upload"
                ?disabled=${this.busy || this.planItemsForType(typeName).length === 0}
                title=${this.tr(MSG.checkinScopeHint, { n: this.planItemsForType(typeName).length })}
                @click=${() => void this.onCheckinScope(this.planItemsForType(typeName), typeName)}
              >
                ${this.tr(MSG.checkin)}
              </ix-button>`
            : nothing}
        </div>
        <div class="composer-scroll">
          ${this.instanceFormType === typeName && saved !== undefined ? this.renderInstanceDraftRow(saved) : nothing}
          ${instances.length === 0
            ? html`<div class="empty small">${this.tr(MSG.instanceNone)}</div>`
            : instances.map((instance) => this.renderInstanceBlock(instance, ws))}
        </div>
      </section>
    `;
  }

  /**
   * ONE verdict about a DP type — never two.
   *
   * The plan's chip ("to create" / "to update") and the sync chip ("in sync" / "diverged" /
   * "not created") answer the same question from two sources, and showing both let them
   * contradict each other: a type nobody has created announced "to update" beside "not
   * created". The plan speaks when it has something pending on the type; the comparison with
   * the project speaks otherwise.
   */
  private renderTypeVerdict(typeName: string, plan: EngPlan | null, saved: ModelTemplate | undefined): TemplateResult {
    const status = modelStatus(typeName, plan);
    if (status !== 'synced') return this.renderStatusChip(status);
    if (saved === undefined) return html`<span class="soft small">${this.tr(MSG.instanceModelUnsaved)}</span>`;
    return this.renderModelSync(saved);
  }

  /**
   * The DP types this tab is about: the working copy's, the models' targets, and the
   * PROJECT's types that carry datapoints of a model's type.
   *
   * The models' targets are the addition that matters: a model built on an existing type
   * describes nothing in the working copy yet, and listing only the working copy's types made
   * it — and its instances — invisible.
   */
  /**
   * The project's own defaults for a deployment decision — used when a model pinned none.
   *
   * The core falls back to the tokens `EVENT` and `alert`, which are what an engineer says and NOT
   * datapoints: written verbatim they fail (`_archive.1._class` must name an `_NGA_Group`) and,
   * once the write resolves them, the working copy and the project disagree for ever — the
   * instance that stayed "to update" after every check-in. So the page, which has read both lists,
   * hands the real names down: the group whose name contains EVENT (else the first usable one) and
   * the class containing "alert" (else the first).
   */
  private projectProfileContext(): { archiveGroup?: string; alarmClass?: string; pollGroup?: string; subscription?: string } {
    const groups = this.configOptions.archiveGroups;
    const classes = this.configOptions.alarmClasses;
    const polls = this.configOptions.pollGroups;
    const subs = this.configOptions.subscriptions;
    const archiveGroup = groups.find((name) => name.toLowerCase().includes('event')) ?? groups[0];
    const alarmClass = classes.find((name) => name.toLowerCase().includes('alert')) ?? classes[0];
    // The NORMAL rhythm as the polled default, and the fastest subscription for what is pushed —
    // the two defaults an operator would pick, offered so nothing has to be typed to start.
    const pollGroup = polls.find((name) => name.toLowerCase().includes('normal')) ?? polls[0];
    const subscription = subs.find((name) => name.toLowerCase().includes('fast')) ?? subs[0];
    return {
      ...(archiveGroup === undefined ? {} : { archiveGroup }),
      ...(alarmClass === undefined ? {} : { alarmClass }),
      ...(pollGroup === undefined ? {} : { pollGroup }),
      ...(subscription === undefined ? {} : { subscription })
    };
  }

  private instanceTypeNames(ws: Workspace): string[] {
    const names = new Set<string>([
      ...ws.types.map((type) => type.typeName),
      ...ws.dps.map((dp) => dp.dpType),
      ...this.models.map((model) => model.typeName)
    ]);
    return [...names].sort((first, second) => first.localeCompare(second));
  }

  /** One instance: its datapoint, the equipment it reads, its status — then its DPEs. */
  private renderInstanceBlock(instance: ModelInstance, ws: Workspace): TemplateResult {
    const device = instance.deviceId === undefined ? undefined : this.devices.find((candidate) => candidate.id === instance.deviceId);
    const rows = this.gridRows(ws).filter((row) => row.dpe.startsWith(`${instance.dpName}.`));
    return html`
      <div class="instance-block">
        <div class="tree-row">
          <span class="mono tree-name">${instance.dpName}</span>
          ${this.renderStatusChip(instance.status)}
          ${instance.deviceId === undefined
            ? html`<span class="soft small">${this.tr(MSG.instanceNoDevice)}</span>`
            : html`<button
                class="tree-device"
                title=${this.tr(MSG.bookLinkHint, { name: device?.name ?? instance.deviceId })}
                @click=${() => this.openDeviceFromInstance(instance.deviceId as string)}
              >
                ${this.tr(MSG.instanceOnDevice, { device: device?.name ?? instance.deviceId })}
              </button>`}
          <span class="spacer"></span>
          ${instance.managed
            ? html`<span class="chip">${this.tr(MSG.dpesCount, { n: rows.length })}</span>`
            : html`<ix-button
                variant="secondary"
                icon="plus"
                ?disabled=${this.busy || !this.can(EDIT_MODEL)}
                title=${this.tr(MSG.adoptHint)}
                @click=${() => this.onAdoptInstance(instance)}
              >
                ${this.tr(MSG.adopt)}
              </ix-button>`}
          ${this.can('checkin')
            ? html`<ix-icon-button
                size="16"
                variant="primary"
                icon="upload"
                a11y-label=${this.tr(MSG.checkin)}
                title=${this.tr(MSG.checkinScopeHint, { n: this.planItemsForDp(instance.dpName).length })}
                ?disabled=${this.busy || this.planItemsForDp(instance.dpName).length === 0}
                @click=${() => void this.onCheckinScope(this.planItemsForDp(instance.dpName), instance.dpName)}
              ></ix-icon-button>`
            : nothing}
          ${this.can(EDIT_MODEL)
            ? html`<ix-icon-button
                size="16"
                variant="tertiary"
                icon="trashcan"
                a11y-label=${this.tr(MSG.forgetSelectedAction)}
                title=${this.tr(MSG.forgetHint)}
                ?disabled=${this.busy}
                @click=${() => void this.onForgetInstance(instance.dpName)}
              ></ix-icon-button>`
            : nothing}
        </div>
        ${instance.managed
          ? html`<table class="grid">
              <thead>
                <tr>
                  <th>${this.tr(MSG.colDpe)}</th><th>${this.tr(MSG.colType)}</th><th>${this.tr(MSG.colAddress)}</th>
                  <th>${this.tr(MSG.colDir)}</th><th>${this.tr(MSG.colAlarm)}</th><th>${this.tr(MSG.colArchive)}</th>
                  <th>${this.tr(MSG.colRange)}</th><th>${this.tr(MSG.colLiveValue)}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => this.renderGridRow(row))}
              </tbody>
            </table>`
          : html`<div class="form-hint">${this.tr(MSG.statusUnmanagedHint)}</div>`}
      </div>
    `;
  }

  /** The status of a model or an instance, as its own chip. */
  private renderStatusChip(status: InstanceStatus): TemplateResult {
    const label = {
      synced: MSG.statusSynced,
      create: MSG.statusCreate,
      update: MSG.statusUpdate,
      delete: MSG.statusDelete,
      conflict: MSG.statusConflict,
      unmanaged: MSG.statusUnmanaged
    }[status];
    const kind = { synced: 'new', create: 'create', update: 'update', delete: 'delete', conflict: 'conflict', unmanaged: '' }[status];
    const hint = status === 'unmanaged' ? MSG.statusUnmanagedHint : label;
    return html`<span class="chip ${kind}" title=${this.tr(hint)}>${status === 'synced' ? '✓ ' : ''}${this.tr(label)}</span>`;
  }

  /**
   * Re-apply EVERY model — the global counterpart of the per-model button.
   *
   * Sequential on purpose: each pass merges into the workspace the previous one produced, so
   * running them in parallel would race on that single value. Models with no instance are
   * skipped silently (there is nothing to update) and the outcome is counted once.
   */
  private async onReapplyAll(): Promise<void> {
    const ws = this.workspace;
    if (ws === null) return;
    const targets = this.models.filter((model) => instanceTargets(ws, model.typeName).length > 0);
    if (targets.length === 0) {
      this.notice = this.tr(MSG.reapplyAllNothing);
      return;
    }
    for (const model of targets) {
      await this.onReapplyModel(model);
    }
    this.notice = this.tr(MSG.reapplyAllDone, { n: targets.length });
  }

  /**
   * CHECK IN one scope only — one model, or one instance.
   *
   * The panel's own Check-in writes the whole plan, which is the wrong grain when a project
   * holds twenty models and one of them is ready: an operator wants to apply THAT one. So the
   * same plan is filtered and applied with the ordinary semantics — `recreate` is NOT passed,
   * so an existing type is changed in place and an existing datapoint keeps its identity, its
   * configs and its archived values (see the core's `applyPlan`). Nothing here can drop a
   * datapoint; that is what the separate, armed "Re-create" is for.
   */
  private async onCheckinScope(items: PlanItem[], scope: string): Promise<void> {
    const plan = this.plan;
    if (plan === null || items.length === 0) return;
    this.busy = true;
    this.report = null;
    try {
      const report = await this.gateway.checkin({ ...plan, items }, false);
      this.report = report;
      if (report.ok) await this.refreshAfterCheckin();
      this.notice = this.tr(MSG.checkinScopeDone, { scope, n: items.length });
    } catch (error) {
      this.notice = this.tr(MSG.checkinFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** The plan items of one MODEL: its type, its datapoints, their configs. */
  private planItemsForType(typeName: string): PlanItem[] {
    return (this.plan?.items ?? []).filter((item) => this.planItemBelongsTo(item, typeName));
  }

  /**
   * The plan items of ONE instance: the datapoint, its DPEs' configs — and the type when it has
   * to be CREATED.
   *
   * A type UPDATE is excluded: it belongs to the model and applying it "for one instance" would
   * change every other instance too. A type CREATION is not the same thing — a datapoint cannot
   * exist without its type, and a type nobody has yet cannot affect anyone else. Leaving it out
   * is what made a scoped check-in fail with `dpCreate('ESAB','FraDatalogger') … Invalid
   * argument`: the datapoint was written before the type it needs.
   */
  private planItemsForDp(dpName: string): PlanItem[] {
    const dpType = this.workspace?.dps.find((dp) => dp.dpName === dpName)?.dpType;
    return (this.plan?.items ?? []).filter((item) => {
      if (item.kind === 'type') return item.op === 'create' && item.name === dpType;
      if (item.kind === 'dp') return item.name === dpName;
      return item.name.startsWith(`${dpName}.`);
    });
  }

  /**
   * RE-CREATE the type and the datapoints of one model — the destructive escape hatch.
   *
   * Everything else in the studio AMENDS: an existing DP type is changed in place and an
   * existing datapoint keeps its identity, its configs and its archived values (see the
   * core's `applyPlan`). That is right for every ordinary change and cannot serve one case —
   * a type the runtime refuses to change in place. So this exists, armed by a first click,
   * and it says what it costs before the second one.
   */
  private async onRecreate(typeName: string): Promise<void> {
    if (this.recreateArmed !== typeName) {
      this.recreateArmed = typeName;
      this.notice = this.tr(MSG.recreateArm, { type: typeName });
      return;
    }
    this.recreateArmed = '';
    const plan = this.plan;
    if (plan === null) return;
    // Scoped to THIS model: its type item, its datapoints and their configs — never the
    // whole plan, which would re-create every model of the project.
    const items = plan.items.filter((item) => this.planItemBelongsTo(item, typeName));
    if (items.length === 0) {
      this.notice = this.tr(MSG.recreateNothing, { type: typeName });
      return;
    }
    this.busy = true;
    try {
      const report = await this.gateway.checkin({ ...plan, items }, false, true);
      this.report = report;
      await this.refreshAfterCheckin();
      this.notice = this.tr(MSG.recreateDone, { type: typeName, n: items.length });
    } catch (error) {
      this.notice = this.tr(MSG.checkinFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Does this plan item belong to that model? (its type, its DPs, their configs) */
  private planItemBelongsTo(item: PlanItem, typeName: string): boolean {
    if (item.kind === 'type') return item.name === typeName;
    const ws = this.workspace;
    if (ws === null) return false;
    const dpNames = ws.dps.filter((dp) => dp.dpType === typeName).map((dp) => dp.dpName);
    if (item.kind === 'dp') return dpNames.includes(item.name);
    return dpNames.some((dpName) => item.name.startsWith(`${dpName}.`));
  }

  /**
   * ADOPT an existing datapoint into the model: open the instance form pre-filled with its
   * name, so a generation writes the model's configs ONTO it.
   *
   * Nothing is created — the applier finds the datapoint and only writes its configs (see
   * `applyPlan`, which never re-creates). That is what "bring it under the model" means, and
   * it is the answer to a project whose datapoints predate the studio.
   */
  private onAdoptInstance(instance: ModelInstance): void {
    this.genEquipments = instance.dpName;
    this.openInstanceForm(instance.typeName);
  }

  /** Open the instance form of one model, and show that model so the result is in view. */
  private openInstanceForm(typeName: string): void {
    this.instanceFormType = this.instanceFormType === typeName ? null : typeName;
    this.genWarnings = [];
    if (this.instanceFormType !== null) this.instanceModelType = typeName;
  }

  /** Jump from an instance to the equipment it reads (the Devices panel). */
  private openDeviceFromInstance(deviceId: string): void {
    this.selectDevice(deviceId);
    this.panel = 'devices';
  }

  /**
   * Re-apply a model to every instance it already produced.
   *
   * This is what makes a MODEL change reach the datapoints: editing an alarm class or
   * an archive group in the Model tab changes the model, and without this the
   * instances would keep the configs of the previous version — the model saying one
   * thing while the project holds another, with nothing to tell which is current.
   *
   * Each instance is regenerated with the model's CURRENT structure, mappings and
   * policy, for the device it already reads (`instanceTargets`), and merged into the
   * workspace. Nothing reaches the project here: it is a workspace edit, so the
   * Instances tree immediately shows the difference as "to update" — which is the
   * honest state until someone checks it in.
   */
  private async onReapplyModel(model: ModelTemplate): Promise<void> {
    const ws = this.workspace;
    if (!ws) return;
    const targets = instanceTargets(ws, model.typeName);
    if (targets.length === 0) {
      this.notice = this.tr(MSG.reapplyNothing, { name: model.name });
      return;
    }
    const book = this.books.find((candidate) => candidate.id === model.sourceBookId) ?? this.activeBook();
    if (book === null || book === undefined) {
      this.notice = this.tr(MSG.reapplyNoBook, { name: model.name });
      return;
    }
    this.busy = true;
    try {
      let merged = ws;
      const warnings: EngWarning[] = [];
      for (const target of targets) {
        const device = target.deviceId === undefined ? undefined : this.devices.find((d) => d.id === target.deviceId);
        const proposal = generateModelFromBook(book, {
          typeName: model.typeName,
          equipments: [target.equipment],
          deviceId: target.deviceId ?? book.id,
          // Per INSTANCE: each target names its own connection (see the generation above).
          bindConnection: connectionNameOf(device) ?? book.interface?.connection,
          mode: book.interface?.protocol ?? device?.protocol,
          mapping: { structure: model.structure, bindings: model.bindings },
          ...(model.policy === undefined ? {} : { policy: model.policy }),
          profileContext: this.projectProfileContext()
        });
        warnings.push(...proposal.warnings);
        merged = mergeProposal(merged, proposal);
      }
      await this.gateway.saveWorkspace(merged);
      this.workspace = merged;
      this.live = await this.gateway.liveSnapshot(this.liveScope(merged));
      this.recomputePlan();
      // The warnings of the LAST pass would hide the others; they repeat per
      // instance, so one de-duplicated set is what an operator can act on.
      this.genWarnings = dedupeWarnings(warnings);
      this.notice = this.tr(MSG.reapplyDone, { name: model.name, n: targets.length });
    } catch (error) {
      this.notice = this.tr(MSG.genFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * The INSTANCES panel: a two-level tree — models, then the datapoints each has
   * produced and the equipment they read — over the check-in it takes to make them
   * real.
   *
   * It replaces the flat "Control" diff as the panel's FIRST view because the flat
   * list answered the wrong question: it said "312 configs to write", where an
   * operator asks "is my model applied everywhere, and is everything checked in?".
   * The diff is still there, below, as the detail of what a check-in would write —
   * summary first, evidence underneath.
   *
   * Instances are DERIVED from the workspace (the core's `modelInstances`), never
   * stored: a second list would be one more thing to keep in step, and the workspace
   * already knows which datapoints exist and which device each reads.
   */
  private renderInstancesPanel(): TemplateResult {
    const plan = this.plan;
    const ws = this.workspace;
    return html`
      <div class="panel-head">
        <h2>${this.tr(MSG.controlTitle)}</h2>
        ${ws === null ? nothing : this.renderGlobalStatus(ws, plan)}
        <div class="spacer"></div>
        ${this.renderCheckinBlocker(plan)}
        ${this.can(EDIT_MODEL)
          ? html`<ix-button
              variant="secondary"
              icon="refresh"
              ?disabled=${this.busy || this.models.length === 0}
              title=${this.tr(MSG.reapplyAllHint)}
              @click=${() => void this.onReapplyAll()}
            >
              ${this.tr(MSG.reapplyAll)}
            </ix-button>`
          : nothing}
        <ix-button variant="secondary" icon="eye" ?disabled=${this.busy} @click=${this.onTestRead}>
          ${this.tr(MSG.testRead)}
        </ix-button>
        <ix-button variant="secondary" icon="eye" ?disabled=${this.busy || !plan?.items.length} @click=${() => this.doCheckin(true)}>
          ${this.tr(MSG.dryRun)}
        </ix-button>
        <ix-button
          variant="primary"
          icon="upload"
          ?disabled=${this.busy || this.checkinBlocker(plan) !== null}
          title=${this.tr(this.checkinBlocker(plan) ?? MSG.checkinReady)}
          @click=${() => this.doCheckin(false)}
        >
          ${this.tr(MSG.checkin)}
        </ix-button>
      </div>
      ${ws === null
        ? nothing
        : html`<div class="split2 model">
            ${this.renderInstanceMaster(ws, plan)}
            ${this.renderInstanceDetail(ws, plan)}
          </div>`}
      <!-- The flat plan table that used to sit here ("What a check-in would write", its
           summary chips, its housekeeping bar) is GONE: the detail pane above already shows,
           per instance, the DPEs and the configs a check-in would write, so the table
           repeated the same facts without the grouping that makes them readable. What a
           check-in DID is still reported below. -->
      ${this.report ? this.renderReport(this.report) : nothing}
    `;
  }

  /**
   * Take the selected objects out of the workspace, save, re-diff.
   *
   * The live project is not touched — which is exactly why this is safe to offer without
   * an arming step, and why the notice says how many objects left, cascades included: a
   * type takes its datapoints and their configs with it, and an operator must see that
   * number rather than discover it in the next plan.
   */
  private async onForgetInstance(dpName: string): Promise<void> {
    const workspace = this.workspace;
    if (workspace === null) return;
    this.busy = true;
    try {
      // The DATAPOINT, and the core cascades its configs — which is the whole unit an
      // operator thinks in here ("drop this instance"), and the reason this action moved
      // onto the instance row when the flat plan table went.
      const { workspace: cleaned, removed } = forgetInWorkspace(workspace, { dps: [dpName] });
      await this.gateway.saveWorkspace(cleaned);
      this.workspace = cleaned;
      this.recomputePlan();
      this.notice = this.tr(MSG.forgetDone, {
        types: removed.types.length,
        dps: removed.dps.length,
        configs: removed.configs.length
      });
    } catch (error) {
      this.notice = this.tr(MSG.forgetFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * WHY check-in is unavailable, or null when it is available.
   *
   * A primary button that is permanently greyed with no explanation is not a guard,
   * it is a dead end: there is no way to tell "I am not allowed" from "there is
   * nothing to apply", and the two call for opposite actions.
   */
  private checkinBlocker(plan: EngPlan | null): Ml | null {
    if (plan === null) return MSG.checkinNoWorkspace;
    if (plan.items.length === 0) return MSG.checkinNothing;
    if (!this.can('checkin')) return MSG.checkinNoRole;
    return null;
  }

  /** The same reason, said out loud next to the button. */
  private renderCheckinBlocker(plan: EngPlan | null): TemplateResult {
    const blocker = this.checkinBlocker(plan);
    return blocker === null ? html`` : html`<span class="soft small checkin-why">${this.tr(blocker)}</span>`;
  }

  private renderReport(report: ApplyReport): TemplateResult {
    const applied = report.results.filter((r) => r.status === 'applied').length;
    const skipped = report.results.filter((r) => r.status === 'skipped').length;
    const failed = report.results.filter((r) => r.status === 'failed').length;
    // FAILURES FIRST: a check-in of a thousand items is read for what went wrong, and having
    // to scroll past nine hundred "applied" lines to find the one that did not is the report
    // failing at its only job. The order is otherwise the plan's.
    const ordered = [...report.results].sort((first, second) => rank(first.status) - rank(second.status));
    return html`
      <div class="dp-pick-backdrop" @click=${() => (this.report = null)}></div>
      <section class="dp-pick report-dialog" @click=${(event: Event) => event.stopPropagation()}>
        <div class="browser-head">
          <span>${report.dryRun ? this.tr(MSG.reportPreview) : this.tr(MSG.reportApplied)}</span>
          <span class="chip new">${this.tr(MSG.reportCreated, { n: applied })}</span>
          ${skipped > 0 ? html`<span class="chip">${this.tr(MSG.reportSkipped, { n: skipped })}</span>` : nothing}
          ${failed > 0 ? html`<span class="chip conflict">${this.tr(MSG.reportFailed, { n: failed })}</span>` : nothing}
          <span class="spacer"></span>
          <ix-icon-button
            size="16"
            variant="tertiary"
            icon="close"
            a11y-label=${this.tr(MSG.cancel)}
            title=${this.tr(MSG.cancel)}
            @click=${() => (this.report = null)}
          ></ix-icon-button>
        </div>
        <!-- The RESULTS scroll, the counts above them do not: on a long report the summary is
             what stays needed while the list is walked. -->
        <div class="report-scroll">
          <table class="grid compact">
            <tbody>
              ${ordered.map((r) => html`
                <tr>
                  <td><span class="chip ${r.status === 'applied' ? 'new' : r.status === 'failed' ? 'conflict' : ''}">${r.status}</span></td>
                  <td>${r.op} ${r.kind}</td>
                  <td class="mono">${r.name}</td>
                  <td class="mono soft">${r.error ?? ''}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // --- actions ----------------------------------------------------------------

  private currentDevice(): Device | undefined {
    return this.devices.find((d) => d.id === this.selectedDeviceId);
  }

  private selectDevice(id: string): void {
    this.selectedDeviceId = id;
    // Activate the device's first catalog (and reset the filter for the new context).
    this.selectedBookId = this.devices.find((d) => d.id === id)?.bookIds[0] ?? null;
    this.signalFilter = '';
  }

  private selectBook(id: string): void {
    this.selectedBookId = id;
  }

  // --- signal qualification (roles) -------------------------------------------

  /** Entries of the book after the text filter AND the role filter. */
  private visibleSignals(book: AddressBook): BookEntry[] {
    const byText = filterEntries(book, this.signalFilter);
    return this.roleFilter === '' ? byText : byText.filter((e) => (e.role ?? 'unknown') === this.roleFilter);
  }

  /** Role counts of the whole book (drives the picker and the "à qualifier" chip). */
  private roleTally(book: AddressBook): Record<SignalRole, number> {
    return roleCounts(new Map(book.entries.map((e) => [e.path, { role: e.role ?? 'unknown', source: 'rule', ruleId: null }])));
  }

  /**
   * Tooltip explaining WHY an entry has its role — the matched rule, or the fact
   * that a hand overrode it AND what the rules would have said instead. That second
   * half is the one that matters once roles are taggable one by one: an override is
   * invisible otherwise, and it silently outranks every rule.
   *
   * Suffixed with how to change it, since the chip is now the affordance.
   */
  private roleReason(entry: BookEntry): string {
    const assignment = classifyEntry(entry);
    const hint = this.can(EDIT_MODEL) ? ` — ${this.tr(MSG.roleEditHint)}` : '';
    if (entry.role !== undefined && assignment.role !== entry.role) {
      return (
        this.tr(MSG.roleOverridden, {
          rule: this.roleLabel(assignment.role),
          fromRule: this.tr(MSG.roleFromRule)
        }) + hint
      );
    }
    return `${assignment.reason ?? ''}${hint}`;
  }

  private toggleSignal(path: string): void {
    const next = new Set(this.checkedSignals);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.checkedSignals = next;
  }

  private toggleAllSignals(visible: BookEntry[]): void {
    const allChecked = visible.length > 0 && visible.every((e) => this.checkedSignals.has(e.path));
    this.checkedSignals = allChecked ? new Set() : new Set(visible.map((e) => e.path));
  }

  /** Re-run the rule set on the book (manual overrides are preserved server-side). */
  private async onApplyRules(book: AddressBook): Promise<void> {
    this.busy = true;
    try {
      const { book: fresh, delta } = await this.gateway.refreshBook(book.id);
      this.books = this.books.map((b) => (b.id === fresh.id ? fresh : b));
      this.bookDelta = delta ?? null;
      const counts = this.roleTally(fresh);
      this.notice = this.tr(MSG.rulesApplied, {
        name: fresh.name,
        n: fresh.entries.length - counts.unknown,
        total: fresh.entries.length
      });
    } finally {
      this.busy = false;
    }
  }

  /** Set the ACCESS of every checked signal — what fixes an `assumed` access. */
  private async onBulkAccess(book: AddressBook, access: string): Promise<void> {
    if (access === '' || this.checkedSignals.size === 0) return;
    const overrides: Record<string, TagAccess | ''> = {};
    for (const path of this.checkedSignals) overrides[path] = access as TagAccess;
    const count = this.checkedSignals.size;
    this.busy = true;
    try {
      await this.gateway.saveBookAccess(book.id, overrides);
      const fresh = await this.gateway.getBook(book.id);
      if (fresh) this.books = this.books.map((b) => (b.id === fresh.id ? fresh : b));
      this.checkedSignals = new Set();
      this.notice = this.tr(MSG.accessApplied, { access, n: count });
    } finally {
      this.busy = false;
    }
  }

  /** How many signals of this book are hidden by hand. */
  private hiddenCount(book: AddressBook): number {
    return book.excludedPaths?.length ?? 0;
  }

  /**
   * HIDE the checked signals.
   *
   * Hiding, not deleting: a catalog is a reading of a source that gets re-read, so the
   * choice is stored beside the book (like the roles and the access) and survives
   * every refresh. A hidden signal takes no role, no address and no config — and the
   * book says how many are hidden, so the next engineer never models from a catalog
   * that quietly shows less than the machine has.
   */
  private async onHideChecked(book: AddressBook): Promise<void> {
    if (this.checkedSignals.size === 0) return;
    const excluded: Record<string, boolean> = {};
    for (const path of this.checkedSignals) excluded[path] = true;
    const count = this.checkedSignals.size;
    this.busy = true;
    try {
      const fresh = await this.gateway.saveBookExcluded(book.id, excluded);
      this.books = this.books.map((candidate) => (candidate.id === fresh.id ? fresh : candidate));
      this.checkedSignals = new Set();
      this.notice = this.tr(MSG.hideDone, { n: count });
    } catch (error) {
      this.notice = this.tr(MSG.hideFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Bring every hidden signal of this book back (nothing was ever deleted). */
  private async onRestoreHidden(book: AddressBook): Promise<void> {
    const paths = book.excludedPaths ?? [];
    if (paths.length === 0) return;
    const excluded: Record<string, boolean> = {};
    for (const path of paths) excluded[path] = false;
    this.busy = true;
    try {
      const fresh = await this.gateway.saveBookExcluded(book.id, excluded);
      this.books = this.books.map((candidate) => (candidate.id === fresh.id ? fresh : candidate));
      this.notice = this.tr(MSG.restoreDone, { n: paths.length });
    } catch (error) {
      this.notice = this.tr(MSG.hideFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Assign one role to every checked signal (the bulk primitive). */
  private async onBulkRole(book: AddressBook, role: SignalRole): Promise<void> {
    if (role === ('' as SignalRole) || this.checkedSignals.size === 0) return;
    const roles: Record<string, SignalRole> = {};
    for (const path of this.checkedSignals) roles[path] = role;
    const count = this.checkedSignals.size;
    this.busy = true;
    try {
      await this.gateway.saveBookRoles(book.id, roles);
      const fresh = await this.gateway.getBook(book.id);
      if (fresh) this.books = this.books.map((b) => (b.id === fresh.id ? fresh : b));
      this.checkedSignals = new Set();
      this.notice = this.tr(MSG.rolesApplied, { n: count, role: this.roleLabel(role) });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Re-read the selected book's source. For an online book this RE-BROWSES the
   * server; the delta (added / removed / changed) is then shown above the signal
   * table, because a signal that disappeared may still be referenced by the model.
   */
  private async onRefreshBook(): Promise<void> {
    const bookId = this.selectedBookId;
    if (!bookId) return;
    this.busy = true;
    this.bookDelta = null;
    try {
      const { book: fresh, rebrowsed, delta, note } = await this.gateway.refreshBook(bookId);
      this.books = this.books.map((b) => (b.id === bookId ? fresh : b));
      this.bookDelta = delta ?? null;
      this.notice = rebrowsed
        ? this.tr(MSG.refreshRebrowsed, { name: fresh.name, n: fresh.entries.length, delta: this.describeDelta(delta) })
        : this.tr(MSG.refreshRulesOnly, { name: fresh.name, n: fresh.entries.length, note: note ?? '' });
    } catch (error) {
      this.notice = this.tr(MSG.refreshFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Browse the chosen live OPC UA connection into a new (or replaced) book. */
  private async onBrowseConnection(): Promise<void> {
    const connection = this.browseConnection.trim();
    if (connection === '') return;
    const bookId = this.browseBookId.trim() === '' ? `opcua-${connection.toLowerCase()}` : this.browseBookId.trim();
    this.busy = true;
    this.bookDelta = null;
    try {
      const { book, delta } = await this.gateway.browseBook({
        bookId,
        connection,
        name: `OPC UA ${connection}`,
        ...(this.browseRoot.trim() === '' ? {} : { rootNodeId: this.browseRoot.trim() })
      });
      const known = this.books.some((b) => b.id === book.id);
      this.books = known ? this.books.map((b) => (b.id === book.id ? book : b)) : [...this.books, book];
      this.selectedBookId = book.id;
      this.bookDelta = delta ?? null;
      this.notice = this.tr(MSG.browseDone, { conn: connection, n: book.entries.length, delta: this.describeDelta(delta) });
    } catch (error) {
      this.notice = this.tr(MSG.browseFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  private describeDelta(delta: BookDelta | undefined): string {
    if (!delta) return '';
    const parts: string[] = [];
    if (delta.added.length > 0) parts.push(`+${delta.added.length}`);
    if (delta.removed.length > 0) parts.push(`−${delta.removed.length}`);
    if (delta.changed.length > 0) parts.push(`~${delta.changed.length}`);
    return parts.length === 0 ? this.tr(MSG.deltaNone) : ` (${parts.join(' / ')})`;
  }

  // --- device form ------------------------------------------------------------

  /** Open the form on a blank draft (creation). */
  private onAddDevice(): void {
    this.deviceFormId = '';
    this.deviceDraft = emptyDraft('opcua');
    this.deviceProblems = [];
    this.deviceDeleteArmed = false;
    this.panel = 'devices';
  }

  /** Open the form on an existing equipment (edit). */
  private onEditDevice(device: Device): void {
    this.deviceFormId = device.id;
    this.deviceDraft = draftFromDevice(device);
    this.deviceProblems = validateDevice(this.deviceDraft, this.devices.filter((other) => other.id !== device.id));
    this.deviceDeleteArmed = false;
    this.panel = 'devices';
  }

  private closeDeviceForm(): void {
    this.deviceDraft = null;
    this.deviceProblems = [];
    this.deviceDeleteArmed = false;
  }

  /** Patch the draft and re-validate — the form shows problems as you type. */
  private patchDraft(patch: Partial<DeviceDraft>): void {
    if (!this.deviceDraft) return;
    const draft: DeviceDraft = { ...this.deviceDraft, ...patch };
    this.deviceDraft = draft;
    this.deviceProblems = validateDevice(draft, this.devices.filter((other) => other.id !== this.deviceFormId));
    // An edit after the delete was armed is a change of mind — disarm it.
    this.deviceDeleteArmed = false;
  }

  private patchDraftParam(key: string, value: string): void {
    if (!this.deviceDraft) return;
    this.patchDraft({ connection: { ...this.deviceDraft.connection, [key]: value } });
  }

  /**
   * The protocol IS the access mode (the core derives one from the other at
   * normalisation): switching it swaps the connection fields, and the generator
   * will pick the candidate addresses of that dialect — the book's own interface
   * protocol still wins when the catalog carries one.
   */
  private patchDraftProtocol(protocol: string): void {
    this.patchDraft({ protocol: protocol as Device['protocol'] & string });
  }

  private toggleDraftBook(bookId: string): void {
    if (!this.deviceDraft) return;
    const ids = this.deviceDraft.bookIds.includes(bookId)
      ? this.deviceDraft.bookIds.filter((id) => id !== bookId)
      : [...this.deviceDraft.bookIds, bookId];
    this.patchDraft({ bookIds: ids });
  }

  private async onSaveDevice(): Promise<void> {
    const draft = this.deviceDraft;
    if (!draft || blockingProblems(this.deviceProblems).length > 0) return;
    this.busy = true;
    try {
      const { devices, connectionProvision, connectionSecurity } = await this.gateway.saveDevice(this.deviceFormId, draft);
      this.devices = devices;
      const saved = devices.find((device) => device.name === draft.name.trim());
      if (saved) this.selectDevice(saved.id);
      this.closeDeviceForm();
      let notice = this.tr(this.deviceFormId === '' ? MSG.deviceCreated : MSG.deviceUpdated, { name: draft.name.trim() });
      // The save may have CREATED the declared connection in the project (a "new
      // point" request — see the backend's provisionOpcUaConnection). Say so, and
      // refresh the picker so the next form offers it.
      if (connectionProvision !== undefined) {
        if (connectionProvision.created) {
          notice += ` ${this.tr(MSG.connCreated, { name: connectionProvision.name, dp: connectionProvision.dp ?? '' })}`;
          this.connections = await this.gateway.listConnections().catch(() => this.connections);
          this.s7plusConnections = await this.gateway.listS7PlusConnections().catch(() => this.s7plusConnections);
        } else {
          notice += ` ${this.tr(MSG.connCreateFailed, { name: connectionProvision.name, error: connectionProvision.warnings.join(' ') })}`;
        }
        if (connectionProvision.created && connectionProvision.warnings.length > 0) {
          notice += ` ${connectionProvision.warnings.join(' ')}`;
        }
      }
      // The security outcome: what landed on the live connection, and what did not
      // (a refused password names its reason — e.g. no driver certificate yet).
      if (connectionSecurity !== undefined) {
        if (connectionSecurity.applied.length > 0) {
          notice += ` ${this.tr(MSG.connSecurityApplied, { what: connectionSecurity.applied.join(', ') })}`;
        }
        if (connectionSecurity.warnings.length > 0) notice += ` ${connectionSecurity.warnings.join(' ')}`;
      }
      this.notice = notice;
    } catch (error) {
      this.notice = this.tr(MSG.deviceSaveFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Two-step delete: the first click arms the button (and shows what deleting does
   * NOT touch), the second one goes through. Deliberate, like every destructive
   * operation of the studio — there is no undo for a forgotten equipment.
   */
  private onDeleteClick(device: Device): void {
    if (!this.deviceDeleteArmed) {
      this.deviceDeleteArmed = true;
      return;
    }
    void this.onDeleteDevice(device);
  }

  private async onDeleteDevice(device: Device): Promise<void> {
    this.busy = true;
    try {
      const devices = await this.gateway.deleteDevice(device.id);
      this.devices = devices;
      if (this.selectedDeviceId === device.id) {
        this.selectedDeviceId = devices[0]?.id ?? null;
        this.selectedBookId = devices[0]?.bookIds[0] ?? null;
      }
      this.closeDeviceForm();
      this.notice = this.tr(MSG.deviceDeleted, { name: device.name });
    } catch (error) {
      this.notice = this.tr(MSG.deviceSaveFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  private async onTestRead(): Promise<void> {
    if (!this.workspace) return;
    const dpes = Object.keys(this.workspace.configs);
    const results = await this.gateway.testRead(dpes);
    this.testValues = new Map(results.map((r) => [r.dpe, r.ok ? r.value : undefined]));
    this.requestUpdate();
  }

  private async doCheckin(dryRun: boolean): Promise<void> {
    if (!this.plan) return;
    this.busy = true;
    this.report = null;
    try {
      this.report = await this.gateway.checkin(this.plan, dryRun);
      if (!dryRun && this.report.ok) {
        await this.refreshAfterCheckin();
        this.notice = this.tr(MSG.checkinApplied);
      }
    } catch (error) {
      this.notice = this.tr(MSG.checkinFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  /** Re-read the workspace and the project after a write, and re-diff the two. */
  private async refreshAfterCheckin(): Promise<void> {
    const workspace = await this.gateway.getWorkspace();
    this.workspace = workspace;
    this.live = await this.gateway.liveSnapshot(this.liveScope(workspace));
    this.recomputePlan();
  }

  // --- grid model -------------------------------------------------------------

  private testValues = new Map<string, unknown>();

  private gridRows(ws: Workspace): GridRow[] {
    const typeByName = new Map(ws.types.map((t) => [t.typeName, t]));
    // Which DPEs the LIVE project actually has: a value can only be read from
    // one that exists, and a model is mostly made of DPEs that do not exist yet.
    const liveDpes = new Set(Object.keys(this.live?.configs ?? {}));
    const liveDps = new Set((this.live?.dps ?? []).map((dp) => dp.dpName));
    const rows: GridRow[] = [];
    for (const dp of ws.dps) {
      const leaves = flattenLeaves(typeByName.get(dp.dpType)?.structure.children ?? [], '');
      for (const leaf of leaves) {
        const dpe = `${dp.dpName}.${leaf.path}`;
        rows.push({
          dpe,
          leafType: leaf.type,
          configs: ws.configs[dpe] ?? {},
          live: this.testValues.get(dpe),
          // A DPE the project does not have yet cannot be read: the cell then
          // shows `--` instead of an empty space that reads as "no value".
          exists: liveDpes.has(dpe) || liveDps.has(dp.dpName)
        });
      }
    }
    return rows;
  }

  /**
   * {@link gridRows} restricted to the datapoints the model binds to one equipment:
   * a DP qualifies when ANY of its DPE address configs records this `deviceId`, and
   * every row of a qualifying DP is kept (a leaf without a config still belongs to
   * the machine's datapoint). Deliberately keyed on the config's `deviceId` — the
   * provenance the generation writes — never on a name convention.
   */
  private deviceGridRows(ws: Workspace, deviceId: string): GridRow[] {
    const all = this.gridRows(ws);
    const linked = new Set<string>();
    for (const row of all) {
      if (row.configs.address?.deviceId === deviceId) linked.add(dpNameOf(row.dpe));
    }
    return all.filter((row) => linked.has(dpNameOf(row.dpe)));
  }
}

/** `Z01_FOUR001` for `Z01_FOUR001.Mesures.Temperature` — the DP a DPE belongs to. */
function dpNameOf(dpe: string): string {
  return dpe.split('.')[0] ?? dpe;
}

interface GridRow {
  dpe: string;
  leafType: string;
  configs: NonNullable<Workspace['configs'][string]>;
  live: unknown;
  /** The DPE exists in the LIVE project — otherwise there is no value to read. */
  exists: boolean;
}

/**
 * De-duplicate warnings by code + params: re-applying a model to N instances
 * repeats the same diagnostics N times, and a list that says the same sentence
 * eight times is a list nobody reads to the end.
 */
function dedupeWarnings(warnings: EngWarning[]): EngWarning[] {
  const seen = new Map<string, EngWarning>();
  for (const warning of warnings) seen.set(`${warning.code}|${JSON.stringify(warning.params ?? {})}`, warning);
  return [...seen.values()];
}

function flattenLeaves(children: { name: string; type: string; children?: unknown[] }[], prefix: string): { path: string; type: string }[] {
  const out: { path: string; type: string }[] = [];
  for (const child of children) {
    const path = prefix === '' ? child.name : `${prefix}.${child.name}`;
    if (child.type === 'Struct' && Array.isArray(child.children)) {
      out.push(...flattenLeaves(child.children as { name: string; type: string }[], path));
    } else {
      out.push({ path, type: child.type });
    }
  }
  return out;
}

/**
 * `_address.._direction` as the three words an engineer reads in PARA.
 *
 * Every direction, not the three that used to be listed: a `rw` leaf SUBSCRIBED is `IO_SPONT`
 * (6), not `IO_POLL` (7), and it showed as `IN` — the column then denied the write path the
 * address actually carries. The catalog's access is what this column reports: `r` → IN,
 * `rw` → I/O, `w` → OUT, whatever the acquisition.
 */
function dirLabel(direction: number): string {
  if (isReadingDirection(direction)) {
    return direction === DpAddressDirection.IO_SPONT ||
      direction === DpAddressDirection.IO_POLL ||
      direction === DpAddressDirection.IO_SQUERY ||
      direction === DpAddressDirection.IO_CYCLIC_ON_USE ||
      direction === DpAddressDirection.IO_SPONT_ON_USE
      ? 'I/O'
      : 'IN';
  }
  return direction === DpAddressDirection.OUTPUT || direction === DpAddressDirection.OUTPUT_SINGLE ? 'OUT' : '—';
}

/** `ix-select` reports `string | string[]`; a single-mode select means the first. */
/** Report ordering: failures, then skipped, then applied (see renderReport). */
function rank(status: string): number {
  if (status === 'failed') return 0;
  if (status === 'skipped') return 1;
  return 2;
}

function firstOf(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

/**
 * ` (8)` after a tab label, or nothing at zero.
 *
 * In the LABEL rather than `ix-tab-item`'s own `counter` badge: the badge does not
 * render here (the tabs are Stencil-lazy and the value never reaches the shadow
 * DOM), and the pending-change count is the one number that tells an operator there
 * is something to check in — it must not depend on a component detail.
 */
function countSuffix(count: number): string {
  return count > 0 ? ` (${count})` : '';
}

if (!customElements.get('wui-eng-studio')) {
  customElements.define('wui-eng-studio', WuiEngStudio);
}

