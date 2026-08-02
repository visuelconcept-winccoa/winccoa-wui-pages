// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engineering Studio — standalone WinCC OA WebUI page (`/eng-studio`).
 *
 * A device-first, check-in/check-out studio to model DP types, datapoints and
 * their configs (address / alarm / archive / range) from communicating
 * equipment. Three panels:
 *   1. Devices + address books  — the equipment and their catalogs;
 *   2. Model                    — the address-book browser (pick → resolved
 *                                 rows) and the signal grid (mass edit);
 *   3. Control (check-in)       — the diff vs the live project, dry-run, apply.
 *
 * Decoupling: the page depends ONLY on `lit` and the pure
 * `@visuelconcept/wui-eng-core`. All I/O goes through an injected
 * {@link EngGateway} — {@link HttpEngGateway} in the shell, {@link DemoEngGateway}
 * for the offline demo / docs / screenshots. No `@wincc-oa/*` import, so the
 * page renders and is screenshotted with no runtime.
 */
import {
  SIGNAL_ROLES,
  SIGNAL_ROLE_LABEL,
  classifyEntry,
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
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type BookEntry,
  type Device,
  type DeviceDraft,
  type DeviceParamSpec,
  type DpTypeStructure,
  type EngPlan,
  type EngWarning,
  type StructureBindings,
  type TagAccess,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { engStudioStyles } from './eng-studio/eng-styles.js';
import { DemoEngGateway } from './eng-studio/data/demo-gateway.js';
import { HttpEngGateway } from './eng-studio/data/http-gateway.js';
import type { BookDelta, EngConnection, EngGateway, EngRole } from './eng-studio/data/gateway.js';
import {
  LANG_LABEL,
  MSG,
  PARAM_LABEL,
  PARAM_OPTION_LABEL,
  ROLE_LABEL,
  WARNING_MSG,
  fmt,
  resolveLang,
  t,
  type Lang,
  type Ml
} from './eng-studio/i18n.js';

type Panel = 'devices' | 'model' | 'control';

export class WuiEngStudio extends LitElement {
  static override readonly styles = engStudioStyles;

  /** Injected gateway. Defaults to HTTP in the shell; the demo entry sets a DemoEngGateway. */
  gateway: EngGateway = new HttpEngGateway();

  @state() private panel: Panel = 'model';
  @state() private devices: Device[] = [];
  @state() private selectedDeviceId: string | null = null;
  /** Every address book (registry); a book may be shared by several devices. */
  @state() private books: AddressBook[] = [];
  /** The active book (of the selected device) driving the browser/signal views. */
  @state() private selectedBookId: string | null = null;
  @state() private bookFilter = '';
  /** Filter for the signal table shown in the Devices panel's address book. */
  @state() private signalFilter = '';
  /** Role filter of the signal table ('' = all). */
  @state() private roleFilter: SignalRole | '' = '';
  /** Signal paths checked for a bulk role assignment. */
  @state() private checkedSignals = new Set<string>();
  /** Model-generation form (Model panel). */
  @state() private genTypeName = '';
  @state() private genZone = 'Z01';
  @state() private genEquipments = '';
  /** Warnings of the last generation, shown under the form. */
  @state() private genWarnings: EngWarning[] = [];
  /** Structure mode: mirror the book's paths, or author the type and map onto it. */
  @state() private genMode: 'mirror' | 'custom' = 'mirror';
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

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    // The shell sets `lang` on the element; the demo and the screenshot harness use
    // `?lang=`; both fall back to <html lang> then the browser (see resolveLang).
    this.uiLang = resolveLang(this.getAttribute('lang'));
    await this.load();
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
      // Browsable connections are a nice-to-have: never fail the whole load on them.
      const connections = await gateway.listConnections().catch(() => [] as EngConnection[]);
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

  /**
   * Render a CORE warning in the UI language: its `code` selects a translated
   * template, into which the core's own `params` are substituted. An unknown code
   * (a newer core, or a `legacy` string from a book written before the structured
   * warnings) falls back to the English message the core shipped with it.
   */
  private warnText(warning: EngWarning): string {
    const translated = WARNING_MSG[warning.code];
    return fmt(translated === undefined ? warning.message : t(translated, this.uiLang), warning.params ?? {});
  }

  /** Public: set the UI language (shell, demo entry and screenshot harness). */
  setLang(lang: string): void {
    this.uiLang = resolveLang(lang);
  }

  override render(): TemplateResult {
    return html`
      ${this.renderHeader()}
      <div class="body">
        ${this.renderRail()}
        <main class="panel">
          ${this.panel === 'devices' ? this.renderDevicesPanel() : nothing}
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
        <div class="title">
          <span class="logo">⚙</span>
          <div>
            <div class="title-main">${this.tr(MSG.title)}</div>
            <div class="title-sub">${this.tr(MSG.subtitle)}</div>
          </div>
        </div>
        ${this.gateway.isDemo ? html`<span class="demo-banner">${this.tr(MSG.demoBanner)}</span>` : nothing}
        <div class="spacer"></div>
        <nav class="steps">
          ${this.renderStep('devices', this.tr(MSG.step1))}
          ${this.renderStep('model', this.tr(MSG.step2))}
          ${this.renderStep('control', `${this.tr(MSG.step3)}${changes > 0 ? ` (${changes})` : ''}`)}
        </nav>
        ${conflicts > 0
          ? html`<span class="chip conflict" title=${this.tr(MSG.conflictTitle)}>${this.tr(MSG.conflictChip)} ${conflicts}</span>`
          : nothing}
        <select class="lang-picker" @change=${(e: Event) => this.setLang((e.target as HTMLSelectElement).value)}>
          ${(Object.keys(LANG_LABEL) as Lang[]).map(
            (code) => html`<option value=${code} ?selected=${code === this.uiLang}>${LANG_LABEL[code]}</option>`
          )}
        </select>
      </header>
      ${this.notice === '' ? nothing : html`<div class="notice">${this.notice}</div>`}
    `;
  }

  private renderStep(panel: Panel, label: string): TemplateResult {
    return html`<button class="step ${this.panel === panel ? 'active' : ''}" @click=${() => (this.panel = panel)}>${label}</button>`;
  }

  private renderRail(): TemplateResult {
    return html`
      <aside class="rail">
        <div class="rail-head">${this.tr(MSG.devicesRail)}</div>
        ${this.devices.map((device) => this.renderDeviceRow(device))}
        <div class="rail-foot">
          ${this.can('manage-devices') ? html`<button class="btn" @click=${this.onAddDevice}>${this.tr(MSG.addDevice)}</button>` : nothing}
        </div>
      </aside>
    `;
  }

  private renderDeviceRow(device: Device): TemplateResult {
    const selected = device.id === this.selectedDeviceId;
    return html`
      <button class="device ${selected ? 'selected' : ''}" @click=${() => this.selectDevice(device.id)}>
        <span class="dot ${device.state}"></span>
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
          ? html`<div><button class="btn primary" @click=${this.onAddDevice}>${this.tr(MSG.addDevice)}</button></div>`
          : nothing}
      </div>`;
    }
    const books = this.booksOfDevice(device);
    const book = this.activeBook();
    return html`
      <div class="panel-head">
        <h2>${device.name}</h2>
        <span class="chip">${this.protocolLabel(device)}</span>
        <span class="chip"><span class="dot ${device.state}"></span>${device.state}</span>
        <span class="chip">${this.tr(MSG.bookCount, { n: books.length })}</span>
        <div class="spacer"></div>
        ${this.can('manage-devices')
          ? html`<button class="btn" @click=${() => this.onEditDevice(device)}>${this.tr(MSG.deviceEdit)}</button>`
          : nothing}
        ${this.can('manage-devices')
          ? html`<button class="btn primary" ?disabled=${this.busy || book == null} @click=${this.onRefreshBook}>${this.tr(MSG.refreshBook)}</button>`
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
          ? html`<button class="btn danger" ?disabled=${this.busy} @click=${() => this.onDeleteClick(device)}>
              ${this.tr(this.deviceDeleteArmed ? MSG.deviceDeleteConfirm : MSG.deviceDelete)}
            </button>`
          : nothing}
        <button class="btn" @click=${() => this.closeDeviceForm()}>${this.tr(MSG.cancel)}</button>
        <button
          class="btn primary"
          ?disabled=${this.busy || blocking.length > 0 || !this.can('manage-devices')}
          @click=${() => void this.onSaveDevice()}
        >
          ${this.tr(MSG.save)}
        </button>
      </div>
      <div class="panel-scroll">
        <div class="device-form">
          ${this.deviceDeleteArmed ? html`<div class="form-hint danger">${this.tr(MSG.deviceDeleteHint)}</div>` : nothing}
          <section class="card">
            <div class="card-title">${this.tr(MSG.deviceIdentity)}</div>
            <label class="form-row">
              <span>${this.tr(MSG.deviceName)}</span>
              <input
                class="filter"
                placeholder="Z01_FOUR001"
                .value=${draft.name}
                @input=${(e: Event) => this.patchDraft({ name: (e.target as HTMLInputElement).value })}
              />
            </label>
            <div class="form-hint">
              ${editing
                ? this.tr(MSG.deviceIdFixed, { id: this.deviceFormId })
                : this.tr(MSG.deviceIdDerived, { id: draft.name.trim() === '' ? '…' : deviceIdFrom(draft.name) })}
            </div>
            <label class="form-row">
              <span>${this.tr(MSG.deviceProtocol)}</span>
              <select class="filter" @change=${(e: Event) => this.patchDraftProtocol((e.target as HTMLSelectElement).value)}>
                ${PROTOCOLS.map(
                  (protocol) => html`<option value=${protocol} ?selected=${protocol === draft.protocol}>
                    ${this.protocolOf(protocol)}
                  </option>`
                )}
              </select>
            </label>
            <div class="form-row">
              <span>${this.tr(MSG.deviceAccessModes)}</span>
              <div class="mode-boxes">
                ${PROTOCOLS.map(
                  (mode) => html`<label class="mode-box">
                    <input
                      type="checkbox"
                      .checked=${draft.accessModes.includes(mode)}
                      @change=${() => this.toggleDraftMode(mode)}
                    />
                    ${this.protocolOf(mode)}
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
              <input
                class="filter mono"
                type="number"
                min="1"
                placeholder="3"
                .value=${draft.driverNumber === undefined ? '' : String(draft.driverNumber)}
                @input=${(e: Event) => this.patchDraft({ driverNumber: (e.target as HTMLInputElement).value })}
              />
            </label>
            <label class="form-row">
              <span>${this.tr(MSG.devicePollGroup)}</span>
              <input
                class="filter mono"
                placeholder="_EngStudio_Poll"
                .value=${draft.pollGroup ?? ''}
                @input=${(e: Event) => this.patchDraft({ pollGroup: (e.target as HTMLInputElement).value })}
              />
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
              : html`<div class="book-boxes">
                  ${this.books.map((book) => {
                    const shared = this.otherDevicesSharing(book.id).filter((name) => name !== draft.name);
                    return html`<label class="mode-box" title=${book.name}>
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
    if (spec.kind === 'choice' || spec.kind === 'flag') {
      const options = spec.kind === 'flag' ? ['true', 'false'] : (spec.options ?? []);
      return html`<label class="form-row">
        ${label}
        <select class="filter" @change=${(e: Event) => this.patchDraftParam(spec.key, (e.target as HTMLSelectElement).value)}>
          <option value="" ?selected=${current === ''}>${this.tr(MSG.paramUnset)}</option>
          ${options.map(
            (option) => html`<option value=${option} ?selected=${option === current}>${this.paramOption(spec.key, option)}</option>`
          )}
        </select>
      </label>`;
    }
    return html`<label class="form-row">
      ${label}
      <input
        class="filter ${spec.kind === 'text' ? '' : 'mono'}"
        type=${spec.kind === 'number' || spec.kind === 'port' ? 'number' : 'text'}
        placeholder=${spec.example ?? ''}
        .value=${current}
        @input=${(e: Event) => this.patchDraftParam(spec.key, (e.target as HTMLInputElement).value)}
      />
    </label>`;
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
          <label>
            ${this.tr(MSG.browseConnection)}
            <select
              .value=${this.browseConnection}
              @change=${(e: Event) => (this.browseConnection = (e.target as HTMLSelectElement).value)}
            >
              ${this.connections.map(
                (c) => html`<option value=${c.name}>${c.name}${c.connected ? '' : this.tr(MSG.disconnectedSuffix)}</option>`
              )}
            </select>
          </label>
          <label>
            ${this.tr(MSG.browseRoot)}
            <input
              class="mono"
              placeholder="ns=0;i=85 (Objects)"
              .value=${this.browseRoot}
              @input=${(e: Event) => (this.browseRoot = (e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            ${this.tr(MSG.browseBookId)}
            <input
              placeholder=${this.tr(MSG.browseBookIdPlaceholder)}
              .value=${this.browseBookId}
              @input=${(e: Event) => (this.browseBookId = (e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="btn"
            ?disabled=${this.busy || !this.can('manage-devices') || this.browseConnection === ''}
            @click=${() => void this.onBrowseConnection()}
          >
            ${this.tr(MSG.browseRun)}
          </button>
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
              </tr>
            </thead>
            <tbody>
              ${entries.map((entry) => this.renderSignalRow(entry, modes))}
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
        <button class="btn" ?disabled=${this.busy} title=${this.tr(MSG.applyRulesTitle)} @click=${() => this.onApplyRules(book)}>
          ${this.tr(MSG.applyRules)}
        </button>
        <span class="soft">${this.tr(MSG.checkedCount, { n: checked })}</span>
        <select
          class="filter"
          ?disabled=${checked === 0 || !this.can('edit-model')}
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
        ${checked > 0 ? html`<button class="btn" @click=${() => (this.checkedSignals = new Set())}>${this.tr(MSG.uncheckAll)}</button>` : nothing}
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

  private renderSignalRow(entry: BookEntry, deviceModes: string[]): TemplateResult {
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
        <td>
          <span class="chip role role-${role}" title=${this.roleReason(entry)}>${this.roleLabel(role)}</span>
        </td>
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
      </tr>
    `;
  }

  // --- panel 2: model (book browser + signal grid) ----------------------------

  private renderModelPanel(): TemplateResult {
    return html`
      <div class="split2">
        ${this.renderBookBrowser()}
        ${this.renderSignalGrid()}
      </div>
    `;
  }

  private renderBookBrowser(): TemplateResult {
    const device = this.currentDevice();
    const deviceBooks = device ? this.booksOfDevice(device) : [];
    const book = this.activeBook();
    const entries = book ? filterEntries(book, this.bookFilter) : [];
    return html`
      <section class="browser">
        <div class="browser-head">
          <span>${this.tr(MSG.bookOf, { name: device?.name ?? '' })}</span>
          <input
            class="filter"
            placeholder="filtrer…"
            .value=${this.bookFilter}
            @input=${(e: Event) => (this.bookFilter = (e.target as HTMLInputElement).value)}
          />
        </div>
        ${deviceBooks.length > 1
          ? html`<div class="browser-books">
              ${deviceBooks.map(
                (b) => html`<button class="mini-tab ${b.id === this.selectedBookId ? 'active' : ''}" @click=${() => this.selectBook(b.id)} title=${b.name}>${b.name}</button>`
              )}
            </div>`
          : nothing}
        <div class="browser-list">
          ${book == null
            ? html`<div class="empty small">${this.tr(MSG.noBookForDevice)}</div>`
            : entries.map((entry) => this.renderBookEntry(entry))}
        </div>
        <div class="browser-foot">${this.tr(MSG.signalsOf, { shown: entries.length, total: book?.entries.length ?? 0 })}</div>
        ${book ? this.renderGenerator(book) : nothing}
      </section>
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
        <label class="gen-row"><span>type</span>
          <input
            class="filter"
            placeholder="Equip_Four"
            .value=${this.genTypeName}
            @input=${(e: Event) => (this.genTypeName = (e.target as HTMLInputElement).value)}
          /></label>
        <label class="gen-row"><span>${this.tr(MSG.genZone)}</span>
          <input
            class="filter"
            placeholder="Z01"
            .value=${this.genZone}
            @input=${(e: Event) => (this.genZone = (e.target as HTMLInputElement).value)}
          /></label>
        <label class="gen-row"><span>${this.tr(MSG.genEquipments)}</span>
          <input
            class="filter"
            placeholder="FOUR001, FOUR002"
            .value=${this.genEquipments}
            @input=${(e: Event) => (this.genEquipments = (e.target as HTMLInputElement).value)}
          /></label>
        <label class="gen-row"><span>${this.tr(MSG.genStructure)}</span>
          <select
            class="filter"
            .value=${this.genMode}
            @change=${(e: Event) => this.onGenMode(book, (e.target as HTMLSelectElement).value as 'mirror' | 'custom')}
          >
            <option value="mirror" ?selected=${this.genMode === 'mirror'}>${this.tr(MSG.genMirror)}</option>
            <option value="custom" ?selected=${this.genMode === 'custom'}>${this.tr(MSG.genCustom)}</option>
          </select></label>
        ${this.genMode === 'custom' ? this.renderCustomStructure(book) : nothing}
        <button
          class="btn primary gen-btn"
          ?disabled=${this.busy || !this.can('edit-model') || this.genTypeName.trim() === ''}
          @click=${() => this.onGenerateModel(book)}
        >${this.tr(MSG.genRun)}</button>
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
   * Custom-structure editor: an OUTLINE (indent = nesting, `Name : Type` = leaf)
   * plus the mapping of each leaf onto a book signal.
   *
   * A textarea rather than a tree widget on purpose: the outline is readable,
   * diffable, pasteable between projects, and it is what a house standard looks
   * like in a spec document. Switching to this mode pre-fills it with the MIRRORED
   * structure, so authoring starts from something that already works.
   */
  private renderCustomStructure(book: AddressBook): TemplateResult {
    const parsed = parseStructureOutline(this.genOutline, this.genTypeName.trim() || 'Type');
    const leaves = structureLeaves(parsed.structure);
    const bound = leaves.filter((leaf) => (this.genBindings[leaf.segments.join('.')] ?? '') !== '').length;
    const entries = this.visibleSignals(book);
    return html`
      <div class="gen-structure">
        <div class="gen-sub">${this.tr(MSG.outlineHint)}</div>
        <textarea
          class="outline mono"
          rows="8"
          spellcheck="false"
          .value=${this.genOutline}
          @input=${(e: Event) => this.onOutlineInput((e.target as HTMLTextAreaElement).value)}
        ></textarea>
        ${this.genOutlineErrors.length > 0
          ? html`<ul class="gen-warnings warn-inline">${this.genOutlineErrors.map((error) => html`<li>${this.warnText(error)}</li>`)}</ul>`
          : nothing}
        <div class="gen-map-head">
          <span>${this.tr(MSG.mappedCount, { n: bound, total: leaves.length })}</span>
          <button class="btn" ?disabled=${this.busy} @click=${() => this.onAutoBind(book)}>${this.tr(MSG.autoBind)}</button>
        </div>
        ${this.genAmbiguous.length > 0
          ? html`<ul class="gen-warnings warn-inline">
              ${this.genAmbiguous.map(
                (item) => html`<li>${this.tr(MSG.ambiguousLeaf, { leaf: item.leaf, candidates: item.candidates.join(', ') })}</li>`
              )}
            </ul>`
          : nothing}
        <div class="map-table">
          ${leaves.map((leaf) => {
            const path = leaf.segments.join('.');
            return html`
              <div class="map-row">
                <span class="mono map-leaf">${path}</span>
                <span class="chip">${leaf.leafType}</span>
                <select class="filter" @change=${(e: Event) => this.onBind(path, (e.target as HTMLSelectElement).value)}>
                  <!-- \`selected\` on the option, NOT \`.value\` on the select: Lit sets
                       a property before the options of the same update exist, so
                       \`.value\` would silently fall back to the first option. -->
                  <option value="" ?selected=${(this.genBindings[path] ?? '') === ''}>${this.tr(MSG.notMapped)}</option>
                  ${entries.map(
                    (entry) => html`<option value=${entry.path} ?selected=${this.genBindings[path] === entry.path}>
                      ${entry.path} (${entry.leafType})
                    </option>`
                  )}
                </select>
              </div>
            `;
          })}
        </div>
      </div>
    `;
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
    const device = this.currentDevice();
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

  private renderBookEntry(entry: BookEntry): TemplateResult {
    const modes = Object.keys(entry.addresses);
    return html`
      <div class="book-entry">
        <div class="be-main">
          <span class="be-path mono">${entry.path}</span>
          ${entry.comment ? html`<span class="be-comment">${entry.comment}</span>` : nothing}
        </div>
        <span class="chip">${entry.leafType}</span>
        <span class="chip acc">${entry.access}</span>
        ${modes.map((m) => html`<span class="chip mode">${m}</span>`)}
        ${entry.unmapped ? html`<span class="chip conflict" title="type non mappé">?</span>` : nothing}
      </div>
    `;
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
          <button class="btn" @click=${this.onTestRead} ?disabled=${this.busy}>${this.tr(MSG.testRead)}</button>
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

  // --- panel 3: control / check-in --------------------------------------------

  private renderControlPanel(): TemplateResult {
    const plan = this.plan;
    return html`
      <div class="panel-head">
        <h2>${this.tr(MSG.controlTitle)}</h2>
        <div class="spacer"></div>
        <button class="btn" ?disabled=${this.busy || !plan?.items.length} @click=${() => this.doCheckin(true)}>${this.tr(MSG.dryRun)}</button>
        <button class="btn primary" ?disabled=${this.busy || !this.can('checkin') || !plan?.items.length} @click=${() => this.doCheckin(false)}>
          ${this.tr(MSG.checkin)}
        </button>
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
              <div class="diff-scroll">
                <table class="grid">
                  <thead><tr>
                    <th>${this.tr(MSG.colOp)}</th><th>${this.tr(MSG.colObject)}</th><th>${this.tr(MSG.colName)}</th>
                    <th>${this.tr(MSG.fieldDetail)}</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${plan.items.map((item) => html`
                      <tr class=${item.conflict ? 'conflict-row' : ''}>
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
              ${plan.warnings.length > 0
                ? html`<div class="warn-text">${plan.warnings.map((w) => html`<div>⚠ ${this.warnText(w)}</div>`)}</div>`
                : nothing}
            `}
      ${this.report ? this.renderReport(this.report) : nothing}
    `;
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
    // Activate the device's first book (reset filters for the new context).
    this.selectedBookId = this.devices.find((d) => d.id === id)?.bookIds[0] ?? null;
    this.signalFilter = '';
    this.bookFilter = '';
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

  /** Tooltip explaining WHY an entry has its role (the matched rule's note). */
  private roleReason(entry: BookEntry): string {
    const assignment = classifyEntry(entry);
    if (entry.role !== undefined && assignment.role !== entry.role) {
      return `rôle imposé manuellement (la règle aurait proposé « ${SIGNAL_ROLE_LABEL[assignment.role]} »)`;
    }
    return assignment.reason ?? '';
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

if (!customElements.get('wui-eng-studio')) {
  customElements.define('wui-eng-studio', WuiEngStudio);
}
