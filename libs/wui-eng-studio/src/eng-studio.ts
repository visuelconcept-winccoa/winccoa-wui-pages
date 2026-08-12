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
  generateModelFromBook,
  liveScopeOf,
  mergeProposal,
  parseStructureOutline,
  roleCounts,
  validateDevice,
  structureLeaves,
  templateCoverage,
  templateIdFrom,
  coverageWarnings,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type BookEntry,
  type Device,
  type DeviceDraft,
  type DeviceParamSpec,
  type DpTypeStructure,
  type EngPlan,
  type ForgetSelection,
  type PlanItem,
  type EngWarning,
  type StructureBindings,
  type ModelTemplate,
  type TemplateCoverage,
  type BrowseProgress,
  type OpcUaBrowseNode,
  type TagAccess,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept/wui-eng-core';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { engStudioStyles } from './eng-studio/eng-styles.js';
import { DemoEngGateway } from './eng-studio/data/demo-gateway.js';
import { HttpEngGateway } from './eng-studio/data/http-gateway.js';
import type {
  BookDelta,
  EngConnection,
  EngDriver,
  EngGateway,
  EngRole,
  IngestRequest
} from './eng-studio/data/gateway.js';
import './eng-studio/ui/eng-books.js';
import './eng-studio/ui/eng-structure-tree.js';
import type { BookBrowseDetail, BookIngestDetail } from './eng-studio/ui/eng-book-form.js';
import { driverMismatchHint, renderDriverSelect } from './eng-studio/ui/eng-driver-select.js';
import { renderConnectionSelect, unknownConnectionHint } from './eng-studio/ui/eng-connection-select.js';
import type { StructureBindDetail, StructureChangeDetail } from './eng-studio/ui/eng-structure-tree.js';
import {
  LANG_LABEL,
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

type Panel = 'devices' | 'books' | 'model' | 'control';

/** Tab order of the top bar — the index `ix-tabs` reports and selects. */
const PANEL_ORDER: Panel[] = ['devices', 'books', 'model', 'control'];

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

  @state() private panel: Panel = 'model';
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
  @state() private genTypeName = '';
  @state() private genZone = 'Z01';
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
  /** Warnings of the last generation, shown under the form. */
  @state() private genWarnings: EngWarning[] = [];
  /** Structure mode: mirror the book's paths, or author the type and map onto it. */
  @state() private genMode: 'mirror' | 'custom' = 'mirror';
  /**
   * Which VIEW of the authored structure is shown — the tree (shape it) or the
   * outline (the storage format, as text). Both edit the same `genOutline`.
   */
  @state() private genView: 'tree' | 'text' = 'tree';
  /** Authored structure, as an editable outline (see the core's structure.ts). */
  @state() private genOutline = '';
  /** Parse errors of the outline (shown next to it, never thrown). */
  @state() private genOutlineErrors: EngWarning[] = [];
  /** Target leaf path → book entry path. */
  @state() private genBindings: StructureBindings = {};
  /** Leaves auto-binding could not decide (several equal candidates). */
  @state() private genAmbiguous: { leaf: string; candidates: string[] }[] = [];
  @state() private workspace: Workspace | null = null;
  @state() private live: LiveSnapshot | null = null;
  @state() private plan: EngPlan | null = null;
  @state() private report: ApplyReport | null = null;
  /**
   * Plan rows ticked for removal from the workspace, keyed `<kind>:<name>` (`planKey`).
   * A plan is recomputed on every change, so a row must be identified by WHAT it is, not
   * by its index — an index would move the tick to another object.
   */
  @state() private forgetChecked = new Set<string>();
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
  /** The project's drivers, offered as an equipment's `driverNumber`. */
  @state() private drivers: EngDriver[] = [];
  /** Catalogues panel: the creation form is open (the page owns its visibility). */
  @state() private bookFormOpen = false;
  /** Refusal of the last catalogue creation, shown inside its form. */
  @state() private bookFormError = '';
  /** Progress of the walk in flight (null when none) — see `onWalkBook`. */
  @state() private walking: BrowseProgress | null = null;
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
   * Public: switch the generation to a CUSTOM structure (demo/screenshot harness).
   * With no outline it bootstraps from the mirror; `outline` overrides it to show a
   * house-standard structure mapped onto a differently-shaped book.
   */
  customStructureForDemo(typeName: string, outline?: string): void {
    const book = this.activeBook();
    if (!book) return;
    this.genTypeName = typeName;
    this.genMode = 'custom';
    this.genOutline = outline ?? formatStructureOutline(this.mirrorStructure(book));
    this.genOutlineErrors = parseStructureOutline(this.genOutline, typeName).errors;
    this.genBindings = {};
    this.onAutoBind(book);
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

  /** Public: run a generation with the given form values (demo/screenshot harness). */
  generateForDemo(typeName: string, zone: string, equipments: string): void {
    const book = this.activeBook();
    if (!book) return;
    this.genTypeName = typeName;
    this.genZone = zone;
    this.genEquipments = equipments;
    void this.onGenerateModel(book);
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
      const drivers = await gateway.listDrivers().catch(() => [] as EngDriver[]);
      const models = await gateway.listModels().catch(() => [] as ModelTemplate[]);
      const selectedDeviceId = this.selectedDeviceId ?? devices[0]?.id ?? null;
      const device = devices.find((d) => d.id === selectedDeviceId);
      const selectedBookId = this.selectedBookId ?? device?.bookIds[0] ?? null;
      const workspace = await gateway.getWorkspace();
      const live = await gateway.liveSnapshot(liveScopeOf(workspace));
      if (token !== this.loadToken) return; // superseded (e.g. by useDemo)
      this.roles = roles;
      this.devices = devices;
      this.books = books;
      this.connections = connections;
      this.drivers = drivers;
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

  private recomputePlan(): void {
    if (this.workspace && this.live) {
      this.plan = diffWorkspace(this.workspace, this.live);
    }
  }

  private can(role: EngRole): boolean {
    return this.roles.has(role);
  }

  /** Translated plan-operation label. */
  private opLabel(op: string): string {
    return this.tr(op === 'create' ? MSG.opCreate : op === 'update' ? MSG.opUpdate : MSG.opDelete);
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

  /** Public: set the UI language (shell, demo entry and screenshot harness). */
  setLang(lang: string): void {
    this.uiLang = resolveLang(lang);
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
          ${this.panel === 'control' ? this.renderControlPanel() : nothing}
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
        <ix-select
          class="lang-picker"
          hide-list-header
          .value=${this.uiLang}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.setLang(firstOf(event.detail))}
        >
          ${(Object.keys(LANG_LABEL) as Lang[]).map(
            (code) => html`<ix-select-item value=${code} label=${LANG_LABEL[code]}></ix-select-item>`
          )}
        </ix-select>
      </header>
      <ix-tabs
        .selected=${PANEL_ORDER.indexOf(this.panel)}
        @selectedChange=${(event: CustomEvent<number>) => this.onTab(event.detail)}
      >
        <ix-tab-item>${this.tr(MSG.stepDevices)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepBooks)}${countSuffix(this.books.length)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepModel)}</ix-tab-item>
        <ix-tab-item>${this.tr(MSG.stepControl)}${countSuffix(changes)}</ix-tab-item>
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
    const book = this.activeBook();
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
        ${this.can('manage-devices')
          ? html`<ix-button variant="primary" icon="refresh" ?disabled=${this.busy || book == null} @click=${this.onRefreshBook}>
              ${this.tr(MSG.refreshBook)}
            </ix-button>`
          : nothing}
      </div>
      <div class="panel-scroll">
        ${books.length === 0
          ? html`<div class="empty small">${this.tr(MSG.noBookHint)}</div>`
          : html`
              <div class="book-tabs">
                <span class="book-tabs-label">${this.tr(MSG.books)}&nbsp;:</span>
                ${books.map((b) => this.renderBookTab(b))}
              </div>
              ${book ? this.renderBookDetail(device, book) : nothing}
            `}
      </div>
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
    const specs = allSpecs.filter((spec) => spec.declarative !== true);
    // Parameters that only RECORD how the driver is configured elsewhere get their
    // own card: shown among the connection fields they would read as settings the
    // studio applies, which they are not.
    const declarative = allSpecs.filter((spec) => spec.declarative === true);
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
            <div class="form-row">
              <span>${this.tr(MSG.deviceAccessModes)}</span>
              <div class="box-list">
                ${PROTOCOLS.map(
                  (mode) => html`<label class="box">
                    <input
                      type="checkbox"
                      .checked=${draft.accessModes.includes(mode)}
                      @change=${() => this.toggleDraftMode(mode)}
                    />
                    <span class="box-name">${this.protocolOf(mode)}</span>
                  </label>`
                )}
              </div>
            </div>
            <div class="form-hint">${this.tr(MSG.deviceAccessModesHint)}</div>
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
                onChange: (value) => this.patchDraft({ driverNumber: value })
              })}
            </label>
            <div class="form-hint">
              ${this.drivers.length === 0 ? this.tr(MSG.driverNoneListed) : this.tr(MSG.driverHint)}
            </div>
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

  private renderBookTab(book: AddressBook): TemplateResult {
    const active = book.id === this.selectedBookId;
    const shared = this.otherDevicesSharing(book.id).length > 0;
    return html`
      <button class="book-tab ${active ? 'active' : ''}" @click=${() => this.selectBook(book.id)} title=${book.name}>
        <span class="book-tab-name">${book.name}</span>
        <span class="chip mode">${book.interface ? this.protocolOf(book.interface.protocol) : 'catalogue'}</span>
        <span class="chip">${book.entries.length}</span>
        ${shared ? html`<span class="chip" title=${this.tr(MSG.sharedBook)}>⇆</span>` : nothing}
      </button>
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
    if (spec.key === 'server' && draft.protocol === 'opcua') {
      const hint = unknownConnectionHint(this.connections, current, this.uiLang);
      return html`
        <label class="form-row">
          ${label}
          ${renderConnectionSelect({
            connections: this.connections,
            value: current,
            lang: this.uiLang,
            ...(spec.example === undefined ? {} : { placeholder: spec.example }),
            onChange: (value) => this.patchDraftParam(spec.key, value)
          })}
        </label>
        ${hint === null ? nothing : html`<div class="form-hint warn-inline">${hint}</div>`}
      `;
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

  private renderBookDetail(device: Device, book: AddressBook): TemplateResult {
    const sharedWith = this.otherDevicesSharing(book.id);
    return html`
      <div class="device-grid">
        <section class="card">
          <div class="card-title">${this.tr(MSG.interfaceOf, { name: book.name })}</div>
          ${book.interface
            ? html`
                <table class="kv">
                  <tr><td>${this.tr(MSG.fieldProtocol)}</td><td>${this.protocolOf(book.interface.protocol)}</td></tr>
                  ${book.interface.connection ? html`<tr><td>${this.tr(MSG.fieldConnection)}</td><td class="mono">${book.interface.connection}</td></tr>` : nothing}
                  ${Object.entries(book.interface.params ?? {}).map(([k, v]) => html`<tr><td>${k}</td><td class="mono">${String(v)}</td></tr>`)}
                  <tr><td>${this.tr(MSG.fieldDriver)}</td><td class="mono">${book.interface.driverNumber ?? device.driverNumber ?? '—'}</td></tr>
                </table>
              `
            : html`<div class="empty small">${this.tr(MSG.fileCatalogHint)}</div>`}
        </section>
        <section class="card">
          <div class="card-title">${this.tr(MSG.addressBook)}</div>
          <table class="kv">
            <tr><td>${this.tr(MSG.fieldSource)}</td><td>${book.provenance.kind}${book.provenance.file ? html` · <code>${book.provenance.file}</code>` : nothing}</td></tr>
            <tr><td>${this.tr(MSG.fieldGenerated)}</td><td class="mono">${book.provenance.generatedAt.replace('T', ' ').slice(0, 16)}</td></tr>
            <tr><td>${this.tr(MSG.fieldDetail)}</td><td>${book.provenance.detail ?? '—'}</td></tr>
            <tr><td>${this.tr(MSG.fieldEntries)}</td><td>${this.tr(MSG.entriesValue, { n: book.entries.length, types: book.types.length })}</td></tr>
            ${sharedWith.length > 0
              ? html`<tr><td>${this.tr(MSG.fieldSharedWith)}</td><td>${sharedWith.map((n) => html`<span class="chip">${n}</span> `)}</td></tr>`
              : nothing}
            ${book.warnings.length > 0 ? html`<tr><td>${this.tr(MSG.fieldWarnings)}</td><td class="warn-text">${book.warnings.length}</td></tr>` : nothing}
          </table>
        </section>
      </div>
      ${this.renderBrowseCard(device, book)}
      ${this.renderBookDelta()}
      ${book.warnings.length > 0
        ? html`<section class="card warnings"><div class="card-title">${this.tr(MSG.generatorWarnings)}</div><ul>${book.warnings.map((w) => html`<li>${this.warnText(w)}</li>`)}</ul></section>`
        : nothing}
      ${this.renderDeviceSignals(book)}
    `;
  }

  /**
   * Online OPC UA browse: re-browse the current book's server, or walk another
   * connection into a new catalog. Shown only where it applies — the project must
   * expose an OPC UA connection AND the equipment must speak OPC UA (or already
   * carry a browsed book); an OPC UA form on a Modbus-only equipment is noise.
   */
  private renderBrowseCard(device: Device, book: AddressBook): TemplateResult {
    const applies = device.accessModes.includes('opcua') || book.provenance.kind === 'opcua-browse';
    if (this.connections.length === 0 || !applies) return html``;
    const replayable = book.provenance.kind === 'opcua-browse' && book.provenance.browse !== undefined;
    return html`
      <section class="card">
        <div class="card-title">${this.tr(MSG.browseTitle)}</div>
        <div class="browse-row">
          <ix-select
            label=${this.tr(MSG.browseConnection)}
            .value=${this.browseConnection}
            @valueChange=${(event: CustomEvent<string | string[]>) => (this.browseConnection = firstOf(event.detail))}
          >
            ${this.connections.map(
              (c) => html`<ix-select-item
                value=${c.name}
                label=${c.name + (c.connected ? '' : this.tr(MSG.disconnectedSuffix))}
              ></ix-select-item>`
            )}
          </ix-select>
          <ix-input
            label=${this.tr(MSG.browseRoot)}
            placeholder="ns=0;i=85 (Objects)"
            .value=${this.browseRoot}
            @valueChange=${(event: CustomEvent<string>) => (this.browseRoot = String(event.detail))}
          ></ix-input>
          <ix-input
            label=${this.tr(MSG.browseBookId)}
            placeholder=${this.tr(MSG.browseBookIdPlaceholder)}
            .value=${this.browseBookId}
            @valueChange=${(event: CustomEvent<string>) => (this.browseBookId = String(event.detail))}
          ></ix-input>
          <ix-button
            variant="secondary"
            icon="search"
            ?disabled=${this.busy || !this.can('manage-devices') || this.browseConnection === ''}
            @click=${() => void this.onBrowseConnection()}
          >
            ${this.tr(MSG.browseRun)}
          </ix-button>
        </div>
        <div class="small">
          ${replayable
            ? this.tr(MSG.browseReplayable, { root: book.provenance.browse?.rootNodeId ?? 'Objects' })
            : this.tr(MSG.browseNotReplayable)}
        </div>
      </section>
    `;
  }

  /** Delta of the last source re-read — removals first, they are the risky ones. */
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
                <th>${this.tr(MSG.colUnit)}</th><th>${this.tr(MSG.colAccess)}</th>
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
        @wui:bookselect=${(event: CustomEvent<{ bookId: string }>) => this.selectBook(event.detail.bookId)}
        @wui:booknew=${() => this.openBookForm()}
        @wui:bookcancel=${() => this.closeBookForm()}
        @wui:bookingest=${(event: CustomEvent<BookIngestDetail>) => void this.onIngestBook(event.detail)}
        @wui:bookbrowse=${(event: CustomEvent<BookBrowseDetail>) => void this.onDeclareAndWalk(event.detail)}
        @wui:bookwalk=${(event: CustomEvent<{ bookId: string }>) => void this.onWalkBook(event.detail.bookId)}
        @wui:bookwalkstop=${() => (this.walkCancelled = true)}
        @wui:bookrefresh=${(event: CustomEvent<{ bookId: string }>) => void this.onRefreshBookById(event.detail.bookId)}
        @wui:bookdelete=${(event: CustomEvent<{ bookId: string }>) => void this.onDeleteBook(event.detail.bookId)}
        @wui:bookattach=${(event: CustomEvent<{ bookId: string; deviceIds: string[] }>) => void this.onAttachBook(event.detail)}
      >
        ${this.bookFormOpen || book === null ? nothing : html`<div slot="signals">${this.renderDeviceSignals(book)}</div>`}
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
      this.devices = await this.gateway.saveDevice(device.id, { ...draftFromDevice(device), bookIds });
    }
  }

  // --- panel 3: model (book browser + signal grid) -----------------------------

  /**
   * TWO columns: composing the model on the left, the model it produces on the right.
   *
   * There used to be a third — a browser of the source catalog's entries — and it was
   * what made this screen unusable: the equipment rail, the browser and the grid split
   * the width three ways, leaving the structure editor about 20 rem to draw a name, a
   * type, a mapping and its actions in. The browser was also redundant: the Catalogues
   * panel shows that same table in full (with the roles, the access provenance and the
   * candidate address per mode), and every leaf of the structure tree carries its own
   * signal picker. So the column went, and the composition got the space.
   */
  private renderModelPanel(): TemplateResult {
    return html`
      <div class="split2 model">
        ${this.renderComposer()}
        ${this.renderSignalGrid()}
      </div>
    `;
  }

  /** The composition column: which catalog, which target, and the type itself. */
  private renderComposer(): TemplateResult {
    const book = this.activeBook();
    return html`
      <section class="browser composer">
        <div class="browser-head">
          <span>${this.tr(MSG.composerTitle)}</span>
        </div>
        <div class="composer-scroll">
          ${this.renderCatalogPicker()}
          ${book === null
            ? html`<div class="empty small">${this.tr(MSG.composerNoCatalog)}</div>`
            : html`${this.renderModelLibrary(book)}${this.renderGenerator(book)}`}
        </div>
      </section>
    `;
  }

  /**
   * The MODEL LIBRARY: save what is composed here, and load it back later.
   *
   * A house-standard type is authored once and applied to machine after machine, so
   * it is a stored object rather than form state — the same "template, then
   * instances" move the catalogs got. What a model deliberately does NOT carry is
   * the target equipment, the zone or the equipment names: those are exactly what
   * differs between two applications, and baking them in would make it single-use.
   *
   * Loading one against a DIFFERENT catalog is allowed and checked: its mappings are
   * paths INTO a catalog, so the coverage is reported before generating rather than
   * producing a type quietly full of config-less DPEs.
   */
  private renderModelLibrary(book: AddressBook): TemplateResult {
    const selected = this.models.find((model) => model.id === this.genModelId);
    const coverage = selected === undefined ? null : templateCoverage(selected, book);
    return html`
      <label class="gen-row">
        <span>${this.tr(MSG.modelLibrary)}</span>
        <ix-select
          allow-clear
          i18n-placeholder=${this.tr(MSG.modelNone)}
          .value=${this.genModelId}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.onLoadModel(firstOf(event.detail))}
        >
          ${this.models.map(
            (model) => html`<ix-select-item value=${model.id} label="${model.name} · ${model.typeName}"></ix-select-item>`
          )}
        </ix-select>
      </label>
      <div class="gen-row gen-model-actions">
        <span></span>
        <ix-button
          variant="secondary"
          icon="upload"
          ?disabled=${this.busy || !this.can(EDIT_MODEL) || this.genTypeName.trim() === ''}
          title=${this.tr(MSG.modelSaveHint)}
          @click=${() => void this.onSaveModel(book)}
        >
          ${this.tr(MSG.modelSave)}
        </ix-button>
        ${selected === undefined
          ? nothing
          : html`<ix-button
              variant="danger-secondary"
              icon="trashcan"
              ?disabled=${this.busy || !this.can(EDIT_MODEL)}
              @click=${() => void this.onDeleteModel(selected.id)}
            >
              ${this.tr(MSG.modelDelete)}
            </ix-button>`}
      </div>
      ${coverage === null ? nothing : this.renderCoverage(coverage)}
    `;
  }

  /** What the target catalog can and cannot serve of the loaded model. */
  private renderCoverage(coverage: TemplateCoverage): TemplateResult {
    const warnings = coverageWarnings(coverage);
    return html`
      <div class="gen-hint">
        ${this.tr(MSG.modelCoverage, { bound: coverage.bound, missing: coverage.missing.length, unbound: coverage.unbound.length })}
      </div>
      ${warnings.length === 0
        ? nothing
        : html`<ul class="gen-warnings">${warnings.map((warning) => html`<li>${this.warnText(warning)}</li>`)}</ul>`}
    `;
  }

  /**
   * The TARGET equipment: whose connection, access mode and driver the generated
   * addresses use, and which `deviceId` the configs record.
   *
   * Explicit, and separate from the catalog above, because that is the whole
   * "author once, apply where you need it" move: the same model composed from a
   * shared catalog is generated for THIS equipment now and for another one later.
   * It used to be implicitly the equipment selected in the rail — invisible, and
   * impossible to change without leaving the screen.
   */
  private renderTargetPicker(): TemplateResult {
    const target = this.targetDevice();
    const mismatch = target !== undefined && !this.deviceServesBook(target, this.selectedBookId);
    return html`
      <label class="gen-row">
        <span>${this.tr(MSG.genTarget)}</span>
        <ix-select
          .value=${target?.id ?? ''}
          @valueChange=${(event: CustomEvent<string | string[]>) => (this.genTargetId = firstOf(event.detail))}
        >
          ${this.devices.map(
            (device) => html`<ix-select-item
              value=${device.id}
              label="${device.name} · ${this.protocolLabel(device)}"
            ></ix-select-item>`
          )}
        </ix-select>
      </label>
      ${target === undefined
        ? html`<div class="gen-hint warn-inline">${this.tr(MSG.genTargetMissing)}</div>`
        : mismatch
          ? html`<div class="gen-hint warn-inline">${this.tr(MSG.genTargetNotServed, { name: target.name })}</div>`
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
   * The SOURCE catalog — any catalog of the project, not only the selected
   * equipment's. That is what makes a model authorable independently of a device: a
   * house-standard type is written against a catalog (PackML, a vendor register map),
   * and which equipments it will serve is a later, separate question.
   */
  private renderCatalogPicker(): TemplateResult {
    return html`
      <label class="gen-row">
        <span>${this.tr(MSG.composerCatalog)}</span>
        <ix-select
          .value=${this.selectedBookId ?? ''}
          @valueChange=${(event: CustomEvent<string | string[]>) => this.selectBook(firstOf(event.detail))}
        >
          ${this.books.map(
            (candidate) => html`<ix-select-item
              value=${candidate.id}
              label="${candidate.name} · ${candidate.entries.length}"
            ></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  /**
   * Generate the model from the active book: the roles decide the configs, the
   * VC convention the datapoint names. The result lands in the workspace, so the
   * Control panel's diff immediately shows what a check-in would write.
   */
  private renderGenerator(book: AddressBook): TemplateResult {
    const unknown = this.roleTally(book).unknown;
    return html`
      <div class="generator">
        <div class="gen-title">${this.tr(MSG.genTitle)}</div>
        <label class="gen-row"><span>${this.tr(MSG.genType)}</span>
          <ix-input
            placeholder="Equip_Four"
            .value=${this.genTypeName}
            @valueChange=${(event: CustomEvent<string>) => (this.genTypeName = String(event.detail))}
          ></ix-input></label>
        <label class="gen-row"><span>${this.tr(MSG.genZone)}</span>
          <ix-input
            placeholder="Z01"
            .value=${this.genZone}
            @valueChange=${(event: CustomEvent<string>) => (this.genZone = String(event.detail))}
          ></ix-input></label>
        <label class="gen-row"><span>${this.tr(MSG.genEquipments)}</span>
          <ix-input
            placeholder="FOUR001, FOUR002"
            .value=${this.genEquipments}
            @valueChange=${(event: CustomEvent<string>) => (this.genEquipments = String(event.detail))}
          ></ix-input></label>
        ${this.renderTargetPicker()}
        <label class="gen-row"><span>${this.tr(MSG.genStructure)}</span>
          <ix-select
            .value=${this.genMode}
            @valueChange=${(event: CustomEvent<string | string[]>) =>
              this.onGenMode(book, firstOf(event.detail) as 'mirror' | 'custom')}
          >
            <ix-select-item value="mirror" label=${this.tr(MSG.genMirror)}></ix-select-item>
            <ix-select-item value="custom" label=${this.tr(MSG.genCustom)}></ix-select-item>
          </ix-select></label>
        ${this.genMode === 'custom' ? this.renderCustomStructure(book) : nothing}
        <ix-button
          class="gen-btn"
          variant="primary"
          icon="cogwheel"
          ?disabled=${this.busy || !this.can(EDIT_MODEL) || this.genTypeName.trim() === ''}
          @click=${() => this.onGenerateModel(book)}
        >${this.tr(MSG.genRun)}</ix-button>
        ${unknown > 0
          ? html`<div class="gen-hint warn-inline">${this.tr(MSG.genUnknownHint, { n: unknown })}</div>`
          : nothing}
        ${this.genWarnings.length > 0
          ? html`<ul class="gen-warnings">${this.genWarnings.map((w) => html`<li>${this.warnText(w)}</li>`)}</ul>`
          : nothing}
      </div>
    `;
  }

  /**
   * Custom-structure editor — the same structure through TWO views.
   *
   * The **tree** is where a type is shaped (PARA's grammar, and each leaf carries its
   * mapping so nothing has to be held in one's head). The **outline** text is the
   * storage format and stays editable: it is readable, diffable, pasteable between
   * projects, and it is what a house standard looks like in a spec document.
   *
   * They cannot disagree because there is one value: `genOutline`. The tree parses it,
   * emits a new structure, and the page writes the outline back from it. Switching to
   * this mode pre-fills it with the MIRRORED structure, so authoring starts from
   * something that already works.
   */
  private renderCustomStructure(book: AddressBook): TemplateResult {
    const parsed = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type');
    const leaves = structureLeaves(parsed.structure);
    // Counted against THIS catalog, not merely "has a binding": a model loaded from
    // the library carries paths into the catalog it was authored on, and calling those
    // "mapped" here while the coverage line says none resolve reads as a contradiction.
    const paths = new Set(book.entries.map((entry) => entry.path));
    const bound = leaves.filter((leaf) => paths.has(this.genBindings[leaf.segments.join('.')] ?? '')).length;
    return html`
      <div class="gen-structure">
        <div class="gen-views">
          ${this.renderGenView('tree', MSG.genViewTree)} ${this.renderGenView('text', MSG.genViewText)}
          <span class="spacer"></span>
          <span class="soft small">${this.tr(MSG.mappedCount, { n: bound, total: leaves.length })}</span>
          <ix-button variant="secondary" ?disabled=${this.busy} @click=${() => this.onAutoBind(book)}>
            ${this.tr(MSG.autoBind)}
          </ix-button>
        </div>
        ${this.genView === 'tree' ? this.renderStructureTree(book, parsed.structure) : this.renderOutlineEditor()}
        ${this.genOutlineErrors.length > 0
          ? html`<ul class="gen-warnings warn-inline">${this.genOutlineErrors.map((error) => html`<li>${this.warnText(error)}</li>`)}</ul>`
          : nothing}
        <div class="gen-sub">${this.tr(MSG.genViewHint)}</div>
      </div>
    `;
  }

  private renderGenView(view: 'tree' | 'text', label: Ml): TemplateResult {
    return html`<button class="mini-tab ${this.genView === view ? 'active' : ''}" @click=${() => (this.genView = view)}>
      ${this.tr(label)}
    </button>`;
  }

  /** The tree view: shape the type and map each leaf, in one place. */
  private renderStructureTree(book: AddressBook, structure: DpTypeStructure): TemplateResult {
    return html`
      <wui-eng-structure-tree
        .structure=${structure}
        .entries=${this.visibleSignals(book)}
        .bindings=${this.genBindings}
        .ambiguous=${this.genAmbiguous}
        .canEdit=${this.can(EDIT_MODEL)}
        .uiLang=${this.uiLang}
        @wui:treechange=${(event: CustomEvent<StructureChangeDetail>) => this.onStructureChange(event.detail)}
        @wui:treebind=${(event: CustomEvent<StructureBindDetail>) => this.onBind(event.detail.leaf, event.detail.entryPath)}
      ></wui-eng-structure-tree>
    `;
  }

  /** The outline view: the storage format, editable as text. */
  private renderOutlineEditor(): TemplateResult {
    return html`
      <div class="gen-sub">${this.tr(MSG.outlineHint)}</div>
      <textarea
        class="outline mono"
        rows="10"
        spellcheck="false"
        .value=${this.genOutline}
        @input=${(event: Event) => this.onOutlineInput((event.target as HTMLTextAreaElement).value)}
      ></textarea>
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
   * Load a saved model into the composer: its type name, its structure and its
   * mappings. The zone, the equipment names and the target are NOT touched — they
   * are what differs between two applications of the same model.
   */
  private onLoadModel(id: string): void {
    this.genModelId = id;
    const model = this.models.find((candidate) => candidate.id === id);
    if (model === undefined) return;
    this.genTypeName = model.typeName;
    this.genMode = 'custom';
    this.genOutline = formatStructureOutline(model.structure);
    this.genOutlineErrors = parseStructureOutline(this.genOutline, model.typeName).errors;
    this.genBindings = { ...model.bindings };
    this.genAmbiguous = [];
    this.notice = this.tr(MSG.modelLoaded, { name: model.name, type: model.typeName });
  }

  /**
   * Save the composed model under its type name.
   *
   * Saved in CUSTOM mode only — a mirrored structure is a reading of one catalog's
   * paths, so storing it as a reusable model would promise something it cannot keep:
   * applied to another catalog it would simply mirror that one instead.
   */
  private async onSaveModel(book: AddressBook): Promise<void> {
    const typeName = this.genTypeName.trim();
    if (typeName === '') return;
    const structure =
      this.genMode === 'custom'
        ? parseStructureOutline(this.genOutline, typeName).structure
        : this.mirrorStructure(book);
    const model: ModelTemplate = {
      id: this.genModelId || templateIdFrom(typeName),
      name: typeName,
      typeName,
      structure,
      bindings: this.genMode === 'custom' ? this.genBindings : {},
      sourceBookId: book.id
    };
    this.busy = true;
    try {
      const stored = await this.gateway.saveModel(model);
      this.models = await this.gateway.listModels();
      this.genModelId = stored.id;
      this.notice = this.tr(MSG.modelSaved, { name: stored.name });
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

  /** Switching to custom mode bootstraps the outline from the mirrored structure. */
  private onGenMode(book: AddressBook, mode: 'mirror' | 'custom'): void {
    this.genMode = mode;
    if (mode !== 'custom' || this.genOutline.trim() !== '') return;
    this.genOutline = formatStructureOutline(this.mirrorStructure(book));
    this.genOutlineErrors = [];
    this.onAutoBind(book);
  }

  /** The structure the MIRROR mode would build — the starting point for editing. */
  private mirrorStructure(book: AddressBook): DpTypeStructure {
    const typeName = this.genTypeName.trim() || 'Type';
    return generateModelFromBook(book, {
      typeName,
      equipments: [],
      deviceId: 'preview',
      selection: this.visibleSignals(book).map((entry) => entry.path)
    }).type.structure;
  }

  private onOutlineInput(text: string): void {
    this.genOutline = text;
    this.genOutlineErrors = parseStructureOutline(text, this.genTypeName.trim() || 'Type').errors;
  }

  private onBind(leafPath: string, entryPath: string): void {
    this.genBindings = { ...this.genBindings, [leafPath]: entryPath };
    this.genAmbiguous = this.genAmbiguous.filter((item) => item.leaf !== leafPath);
  }

  /** Name-match the authored leaves onto the book, and keep what it could not decide. */
  private onAutoBind(book: AddressBook): void {
    const { structure } = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type');
    const result = autoBindStructure(structure, this.visibleSignals(book));
    // Keep the operator's own choices: auto-binding fills the gaps, it does not reset.
    this.genBindings = { ...result.bindings, ...this.genBindings };
    this.genAmbiguous = result.ambiguous.filter((item) => (this.genBindings[item.leaf] ?? '') === '');
    const bound = Object.values(this.genBindings).filter((value) => value !== '').length;
    this.notice = this.tr(MSG.autoBindDone, { bound, unbound: result.unbound.length, ambiguous: result.ambiguous.length });
  }

  /** Run the generator, merge into the workspace and refresh the plan. */
  private async onGenerateModel(book: AddressBook): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    // The TARGET, explicitly — see renderTargetPicker. Applying a model is a choice,
    // not a side effect of whichever equipment happens to be selected elsewhere.
    const device = this.targetDevice();
    const equipments = this.genEquipments
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    this.busy = true;
    try {
      const typeName = this.genTypeName.trim();
      const mapping =
        this.genMode === 'custom'
          ? { structure: parseStructureOutline(this.genOutline, typeName).structure, bindings: this.genBindings }
          : undefined;
      const proposal = generateModelFromBook(book, {
        typeName,
        zone: this.genZone.trim() === '' ? undefined : this.genZone.trim(),
        equipments,
        deviceId: device?.id ?? book.id,
        // A template catalog is bound to the selected equipment's own connection.
        bindConnection: book.interface?.connection ?? device?.name,
        mode: book.interface?.protocol ?? device?.accessModes[0],
        // Mirror mode restricts to the visible (filtered) signals like before;
        // mapping mode takes its selection from the bindings themselves.
        ...(mapping === undefined ? {} : { mapping })
      });
      const merged = mergeProposal(workspace, proposal);
      await this.gateway.saveWorkspace(merged);
      this.workspace = merged;
      // Re-read live with the WIDER scope the generated model just introduced.
      this.live = await this.gateway.liveSnapshot(liveScopeOf(merged));
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


  private renderSignalGrid(): TemplateResult {
    const ws = this.workspace;
    if (!ws) return html`<section class="grid-wrap"><div class="empty">${this.tr(MSG.loading)}</div></section>`;
    const rows = this.gridRows(ws);
    return html`
      <section class="grid-wrap">
        <div class="grid-head-bar">
          <span>${this.tr(MSG.modelOf, { name: ws.name })}</span>
          <span class="chip">${this.tr(MSG.typesCount, { n: ws.types.length })}</span>
          <span class="chip">${this.tr(MSG.dpsCount, { n: ws.dps.length })}</span>
          <span class="chip">${this.tr(MSG.configsCount, { n: Object.keys(ws.configs).length })}</span>
          <div class="spacer"></div>
          <ix-button variant="secondary" icon="eye" @click=${this.onTestRead} ?disabled=${this.busy}>
            ${this.tr(MSG.testRead)}
          </ix-button>
        </div>
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
      </section>
    `;
  }

  private renderGridRow(row: GridRow): TemplateResult {
    const cfg = row.configs;
    return html`
      <tr>
        <td class="mono dpe">${row.dpe}</td>
        <td>${row.leafType}</td>
        <td class="mono addr">${cfg.address?.reference ?? html`<span class="soft">—</span>`}</td>
        <td>${cfg.address ? dirLabel(cfg.address.direction) : ''}</td>
        <td>${cfg.alarm ? html`<span class="chip update">${cfg.alarm.kind}</span>` : html`<span class="soft">—</span>`}</td>
        <td>${cfg.archive?.active ? html`<span class="chip new">${cfg.archive.group}</span>` : html`<span class="soft">—</span>`}</td>
        <td>${cfg.range ? html`<span class="mono">${cfg.range.min}‥${cfg.range.max}</span>` : html`<span class="soft">—</span>`}</td>
        <td class="mono live">${row.live === undefined ? '' : String(row.live)}</td>
      </tr>
    `;
  }

  // --- panel 4: control / check-in --------------------------------------------

  private renderControlPanel(): TemplateResult {
    const plan = this.plan;
    return html`
      <div class="panel-head">
        <h2>${this.tr(MSG.controlTitle)}</h2>
        <div class="spacer"></div>
        ${this.renderCheckinBlocker(plan)}
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
      ${plan == null
        ? html`<div class="empty">${this.tr(MSG.noWorkspace)}</div>`
        : plan.items.length === 0
          ? html`<div class="empty success">✓ ${this.tr(MSG.planEmpty)}</div>`
          : html`
              <div class="diff-summary">
                ${this.summaryChip('create', plan)} ${this.summaryChip('update', plan)} ${this.summaryChip('delete', plan)}
                ${plan.items.some((i) => i.conflict)
                  ? html`<span class="chip conflict">${this.tr(MSG.conflictChip)} ${plan.items.filter((i) => i.conflict).length}</span>`
                  : nothing}
              </div>
              ${plan.warnings.length > 0
                ? html`<div class="warn-text plan-warnings">${plan.warnings.map((w) => html`<div>⚠ ${this.warnText(w)}</div>`)}</div>`
                : nothing}
              ${this.renderForgetBar(plan)}
              <div class="diff-scroll">
                <table class="grid">
                  <thead><tr>
                    <th class="pick">
                      <input
                        type="checkbox"
                        title=${this.tr(MSG.forgetAll)}
                        .checked=${this.forgetChecked.size > 0 && this.forgetChecked.size === plan.items.length}
                        @change=${(event: Event) => this.onCheckAllPlan(plan, (event.target as HTMLInputElement).checked)}
                      />
                    </th>
                    <th>${this.tr(MSG.colOp)}</th><th>${this.tr(MSG.colObject)}</th><th>${this.tr(MSG.colName)}</th>
                    <th>${this.tr(MSG.fieldDetail)}</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${plan.items.map((item) => html`
                      <tr class=${item.conflict ? 'conflict-row' : ''}>
                        <td class="pick">
                          <input
                            type="checkbox"
                            .checked=${this.forgetChecked.has(planKey(item))}
                            @change=${() => this.onCheckPlanItem(item)}
                          />
                        </td>
                        <td><span class="chip ${item.op}">${this.opLabel(item.op)}</span></td>
                        <td>${item.kind}</td>
                        <td class="mono">${item.name}</td>
                        <td class="mono soft">${item.detail ?? ''}</td>
                        <td>
                          ${item.conflict
                            ? html`<span class="chip conflict" title=${this.tr(MSG.conflictTitle)}>${this.tr(MSG.conflictChip)}</span>`
                            : nothing}
                        </td>
                      </tr>`)}
                  </tbody>
                </table>
              </div>
            `}
      ${this.report ? this.renderReport(this.report) : nothing}
    `;
  }

  /**
   * The HOUSEKEEPING bar of the plan: what is selected, and the one action that takes it
   * back out of the workspace.
   *
   * The Control tab used to be read-only, which left no way out of a staged item: a model
   * deleted from the library kept its generated datapoints queued for creation for ever,
   * and there was nothing to click. "Forget" is the missing half of "generate" — see the
   * core's `forgetInWorkspace` for what each operation means (it never touches the live
   * project) and for the cascade.
   */
  private renderForgetBar(plan: EngPlan): TemplateResult {
    if (!this.can(EDIT_MODEL)) return html``;
    const picked = plan.items.filter((item) => this.forgetChecked.has(planKey(item)));
    return html`
      <div class="forget-bar">
        <span class="soft small">${this.tr(MSG.forgetHint)}</span>
        <div class="spacer"></div>
        <span class="soft small">${this.tr(MSG.forgetSelected, { n: picked.length })}</span>
        <ix-button
          variant="danger-secondary"
          icon="trashcan"
          ?disabled=${this.busy || picked.length === 0}
          @click=${() => void this.onForgetSelected(plan)}
        >
          ${this.tr(MSG.forgetSelectedAction)}
        </ix-button>
      </div>
    `;
  }

  private onCheckPlanItem(item: PlanItem): void {
    const key = planKey(item);
    const next = new Set(this.forgetChecked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.forgetChecked = next;
  }

  private onCheckAllPlan(plan: EngPlan, checked: boolean): void {
    this.forgetChecked = checked ? new Set(plan.items.map((item) => planKey(item))) : new Set();
  }

  /**
   * Take the selected objects out of the workspace, save, re-diff.
   *
   * The live project is not touched — which is exactly why this is safe to offer without
   * an arming step, and why the notice says how many objects left, cascades included: a
   * type takes its datapoints and their configs with it, and an operator must see that
   * number rather than discover it in the next plan.
   */
  private async onForgetSelected(plan: EngPlan): Promise<void> {
    const workspace = this.workspace;
    if (workspace === null) return;
    const picked = plan.items.filter((item) => this.forgetChecked.has(planKey(item)));
    if (picked.length === 0) return;
    const selection: ForgetSelection = {
      types: picked.filter((item) => item.kind === 'type').map((item) => item.name),
      dps: picked.filter((item) => item.kind === 'dp').map((item) => item.name),
      configs: picked.filter((item) => item.kind === 'config').map((item) => item.name)
    };
    this.busy = true;
    try {
      const { workspace: cleaned, removed } = forgetInWorkspace(workspace, selection);
      await this.gateway.saveWorkspace(cleaned);
      this.workspace = cleaned;
      this.forgetChecked = new Set();
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
    return html`
      <section class="card report">
        <div class="card-title">
          ${report.dryRun ? this.tr(MSG.reportPreview) : this.tr(MSG.reportApplied)} —
          <span class="chip new">${this.tr(MSG.reportCreated, { n: applied })}</span>
          ${skipped > 0 ? html`<span class="chip">${this.tr(MSG.reportSkipped, { n: skipped })}</span>` : nothing}
          ${failed > 0 ? html`<span class="chip conflict">${this.tr(MSG.reportFailed, { n: failed })}</span>` : nothing}
        </div>
        <table class="grid compact">
          <tbody>
            ${report.results.map((r) => html`
              <tr>
                <td><span class="chip ${r.status === 'applied' ? 'new' : r.status === 'failed' ? 'conflict' : ''}">${r.status}</span></td>
                <td>${r.op} ${r.kind}</td>
                <td class="mono">${r.name}</td>
                <td class="mono soft">${r.error ?? ''}</td>
              </tr>`)}
          </tbody>
        </table>
      </section>
    `;
  }

  private summaryChip(op: 'create' | 'update' | 'delete', plan: EngPlan): TemplateResult {
    const n = plan.items.filter((i) => i.op === op).length;
    if (n === 0) return html``;
    return html`<span class="chip ${op}">${n} ${this.opLabel(op)}</span>`;
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
   * Switching protocol also switches the ACCESS MODES to it — the common case is
   * one protocol per equipment, and a stale mode from the previous protocol would
   * make the generator look for an address that does not exist. Extra modes stay
   * addable afterwards (an S7-1500 offers `s7` and `opcua`).
   */
  private patchDraftProtocol(protocol: string): void {
    this.patchDraft({ protocol: protocol as Device['protocol'] & string, accessModes: [protocol as never] });
  }

  private toggleDraftMode(mode: string): void {
    if (!this.deviceDraft) return;
    const modes = new Set(this.deviceDraft.accessModes);
    if (modes.has(mode as never)) modes.delete(mode as never);
    else modes.add(mode as never);
    this.patchDraft({ accessModes: [...modes] as never });
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
      const devices = await this.gateway.saveDevice(this.deviceFormId, draft);
      this.devices = devices;
      const saved = devices.find((device) => device.name === draft.name.trim());
      if (saved) this.selectDevice(saved.id);
      this.closeDeviceForm();
      this.notice = this.tr(this.deviceFormId === '' ? MSG.deviceCreated : MSG.deviceUpdated, { name: draft.name.trim() });
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
        const workspace = await this.gateway.getWorkspace();
        this.workspace = workspace;
        this.live = await this.gateway.liveSnapshot(liveScopeOf(workspace));
        this.recomputePlan();
        this.notice = this.tr(MSG.checkinApplied);
      }
    } catch (error) {
      this.notice = this.tr(MSG.checkinFailed, { error: (error as Error).message });
    } finally {
      this.busy = false;
    }
  }

  // --- grid model -------------------------------------------------------------

  private testValues = new Map<string, unknown>();

  private gridRows(ws: Workspace): GridRow[] {
    const typeByName = new Map(ws.types.map((t) => [t.typeName, t]));
    const rows: GridRow[] = [];
    for (const dp of ws.dps) {
      const leaves = flattenLeaves(typeByName.get(dp.dpType)?.structure.children ?? [], '');
      for (const leaf of leaves) {
        const dpe = `${dp.dpName}.${leaf.path}`;
        rows.push({ dpe, leafType: leaf.type, configs: ws.configs[dpe] ?? {}, live: this.testValues.get(dpe) });
      }
    }
    return rows;
  }
}

interface GridRow {
  dpe: string;
  leafType: string;
  configs: NonNullable<Workspace['configs'][string]>;
  live: unknown;
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

function dirLabel(direction: number): string {
  return direction === 1 ? 'OUT' : direction === 7 ? 'I/O' : 'IN';
}

/** `ix-select` reports `string | string[]`; a single-mode select means the first. */
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

/**
 * Identity of a plan row: its kind and its name. NOT its index — the plan is recomputed
 * after every change, and an index-keyed tick would silently follow whatever row took
 * that position.
 */
function planKey(item: PlanItem): string {
  return `${item.kind}:${item.name}`;
}
