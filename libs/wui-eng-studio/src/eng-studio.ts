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
  generateModelFromBook,
  mergeProposal,
  roleCounts,
  type SignalRole,
  type AddressBook,
  type ApplyReport,
  type BookEntry,
  type Device,
  type EngPlan,
  type LiveSnapshot,
  type Workspace
} from '@visuelconcept/wui-eng-core';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { engStudioStyles } from './eng-studio/eng-styles.js';
import { DemoEngGateway } from './eng-studio/data/demo-gateway.js';
import { HttpEngGateway } from './eng-studio/data/http-gateway.js';
import type { EngGateway, EngRole } from './eng-studio/data/gateway.js';

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
  @state() private genWarnings: string[] = [];
  @state() private workspace: Workspace | null = null;
  @state() private live: LiveSnapshot | null = null;
  @state() private plan: EngPlan | null = null;
  @state() private report: ApplyReport | null = null;
  @state() private roles = new Set<EngRole>();
  @state() private busy = false;
  @state() private notice = '';

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
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
      const selectedDeviceId = this.selectedDeviceId ?? devices[0]?.id ?? null;
      const device = devices.find((d) => d.id === selectedDeviceId);
      const selectedBookId = this.selectedBookId ?? device?.bookIds[0] ?? null;
      const workspace = await gateway.getWorkspace();
      const live = await gateway.liveSnapshot();
      if (token !== this.loadToken) return; // superseded (e.g. by useDemo)
      this.roles = roles;
      this.devices = devices;
      this.books = books;
      this.selectedDeviceId = selectedDeviceId;
      this.selectedBookId = selectedBookId;
      this.workspace = workspace;
      this.live = live;
      this.recomputePlan();
    } catch (error) {
      if (token === this.loadToken) this.notice = `Chargement impossible : ${(error as Error).message}`;
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
            <div class="title-main">Engineering Studio</div>
            <div class="title-sub">Modélisation DPT · DP · configs — check-in / check-out</div>
          </div>
        </div>
        ${this.gateway.isDemo ? html`<span class="demo-banner">Démo hors-ligne — données d'exemple, sans WinCC OA</span>` : nothing}
        <div class="spacer"></div>
        <nav class="steps">
          ${this.renderStep('devices', '1 · Équipements')}
          ${this.renderStep('model', '2 · Modèle')}
          ${this.renderStep('control', `3 · Contrôle${changes > 0 ? ` (${changes})` : ''}`)}
        </nav>
        ${conflicts > 0 ? html`<span class="chip conflict" title="Conflits avec le projet live">${conflicts} conflit${conflicts > 1 ? 's' : ''}</span>` : nothing}
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
        <div class="rail-head">Équipements communicants</div>
        ${this.devices.map((device) => this.renderDeviceRow(device))}
        <div class="rail-foot">
          ${this.can('manage-devices') ? html`<button class="btn" @click=${this.onAddDevice}>+ Ajouter</button>` : nothing}
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
        ${device.bookIds.length > 1 ? html`<span class="chip">${device.bookIds.length} carnets</span>` : nothing}
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
    const device = this.currentDevice();
    if (!device) return html`<div class="empty">Aucun équipement.</div>`;
    const books = this.booksOfDevice(device);
    const book = this.activeBook();
    return html`
      <div class="panel-head">
        <h2>${device.name}</h2>
        <span class="chip">${this.protocolLabel(device)}</span>
        <span class="chip"><span class="dot ${device.state}"></span>${device.state}</span>
        <span class="chip">${books.length} carnet${books.length > 1 ? 's' : ''}</span>
        <div class="spacer"></div>
        ${this.can('manage-devices')
          ? html`<button class="btn primary" ?disabled=${this.busy || book == null} @click=${this.onRefreshBook}>⟳ Rafraîchir le carnet</button>`
          : nothing}
      </div>
      <div class="panel-scroll">
        ${books.length === 0
          ? html`<div class="empty small">Aucun carnet associé — ajoutez une interface (browse OPC UA) ou ingérez un export SimaticML, ou associez un carnet mutualisé.</div>`
          : html`
              <div class="book-tabs">
                <span class="book-tabs-label">Carnets&nbsp;:</span>
                ${books.map((b) => this.renderBookTab(b))}
              </div>
              ${book ? this.renderBookDetail(device, book) : nothing}
            `}
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
        ${shared ? html`<span class="chip" title="Carnet mutualisé">⇆</span>` : nothing}
      </button>
    `;
  }

  private protocolOf(protocol: string): string {
    const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
    return map[protocol] ?? protocol;
  }

  private renderBookDetail(device: Device, book: AddressBook): TemplateResult {
    const sharedWith = this.otherDevicesSharing(book.id);
    return html`
      <div class="device-grid">
        <section class="card">
          <div class="card-title">Interface — ${book.name}</div>
          ${book.interface
            ? html`
                <table class="kv">
                  <tr><td>protocole</td><td>${this.protocolOf(book.interface.protocol)}</td></tr>
                  ${book.interface.connection ? html`<tr><td>connexion</td><td class="mono">${book.interface.connection}</td></tr>` : nothing}
                  ${Object.entries(book.interface.params ?? {}).map(([k, v]) => html`<tr><td>${k}</td><td class="mono">${String(v)}</td></tr>`)}
                  <tr><td>driver</td><td class="mono">${book.interface.driverNumber ?? device.driverNumber ?? '—'}</td></tr>
                </table>
              `
            : html`<div class="empty small">Catalogue de fichier (sans interface live) — lié à l'équipement au check-in via son interface.</div>`}
        </section>
        <section class="card">
          <div class="card-title">Carnet d'adresses</div>
          <table class="kv">
            <tr><td>source</td><td>${book.provenance.kind}${book.provenance.file ? html` · <code>${book.provenance.file}</code>` : nothing}</td></tr>
            <tr><td>généré</td><td class="mono">${book.provenance.generatedAt.replace('T', ' ').slice(0, 16)}</td></tr>
            <tr><td>détail</td><td>${book.provenance.detail ?? '—'}</td></tr>
            <tr><td>entrées</td><td><b>${book.entries.length}</b> signaux · ${book.types.length} type(s)</td></tr>
            ${sharedWith.length > 0
              ? html`<tr><td>mutualisé avec</td><td>${sharedWith.map((n) => html`<span class="chip">${n}</span> `)}</td></tr>`
              : nothing}
            ${book.warnings.length > 0 ? html`<tr><td>avertissements</td><td class="warn-text">${book.warnings.length}</td></tr>` : nothing}
          </table>
        </section>
      </div>
      ${book.warnings.length > 0
        ? html`<section class="card warnings"><div class="card-title">Avertissements du générateur</div><ul>${book.warnings.map((w) => html`<li>${w}</li>`)}</ul></section>`
        : nothing}
      ${this.renderDeviceSignals(book)}
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
          <div class="card-title">Signaux du carnet</div>
          <input
            class="filter"
            placeholder="filtrer chemin ou commentaire…"
            .value=${this.signalFilter}
            @input=${(e: Event) => (this.signalFilter = (e.target as HTMLInputElement).value)}
          />
          <select
            class="filter role-filter"
            .value=${this.roleFilter}
            @change=${(e: Event) => (this.roleFilter = (e.target as HTMLSelectElement).value as SignalRole | '')}
          >
            <option value="">tous les rôles</option>
            ${SIGNAL_ROLES.map(
              (role) => html`<option value=${role} ?selected=${this.roleFilter === role}>${SIGNAL_ROLE_LABEL[role]} (${counts[role]})</option>`
            )}
          </select>
          <span class="soft signals-count">${entries.length} / ${book.entries.length}</span>
          ${counts.unknown > 0
            ? html`<span class="chip conflict" title="Signaux sans rôle — à qualifier">${counts.unknown} à qualifier</span>`
            : html`<span class="chip new" title="Tous les signaux sont qualifiés">tout qualifié</span>`}
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
                <th>chemin</th><th>rôle</th><th>type</th><th>unité</th><th>accès</th>
                <th>type source</th><th>gabarit</th><th>adresses (par mode)</th><th>commentaire</th>
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
        <button class="btn" ?disabled=${this.busy} title="Réappliquer les règles de qualification" @click=${() => this.onApplyRules(book)}>
          ⚙ Appliquer les règles
        </button>
        <span class="soft">${checked} coché${checked > 1 ? 's' : ''}</span>
        <select
          class="filter"
          ?disabled=${checked === 0 || !this.can('edit-model')}
          @change=${(e: Event) => this.onBulkRole(book, (e.target as HTMLSelectElement).value as SignalRole)}
        >
          <option value="">affecter un rôle aux cochés…</option>
          ${SIGNAL_ROLES.filter((r) => r !== 'unknown').map((role) => html`<option value=${role}>${SIGNAL_ROLE_LABEL[role]}</option>`)}
        </select>
        ${checked > 0 ? html`<button class="btn" @click=${() => (this.checkedSignals = new Set())}>décocher</button>` : nothing}
      </div>
    `;
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
          <span class="chip role role-${role}" title=${this.roleReason(entry)}>${SIGNAL_ROLE_LABEL[role]}</span>
        </td>
        <td>${entry.leafType}${entry.unmapped ? html` <span class="chip conflict" title="type non mappé">?</span>` : nothing}</td>
        <td class="unit">${entry.unit ?? html`<span class="soft">—</span>`}</td>
        <td><span class="chip acc">${entry.access}</span></td>
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
          <span>Carnet — ${device?.name ?? ''}</span>
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
            ? html`<div class="empty small">Aucun carnet pour cet équipement.</div>`
            : entries.map((entry) => this.renderBookEntry(entry))}
        </div>
        <div class="browser-foot">${entries.length} / ${book?.entries.length ?? 0} signaux</div>
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
        <div class="gen-title">Générer le modèle depuis ce carnet</div>
        <label class="gen-row"><span>type</span>
          <input
            class="filter"
            placeholder="Equip_Four"
            .value=${this.genTypeName}
            @input=${(e: Event) => (this.genTypeName = (e.target as HTMLInputElement).value)}
          /></label>
        <label class="gen-row"><span>zone</span>
          <input
            class="filter"
            placeholder="Z01"
            .value=${this.genZone}
            @input=${(e: Event) => (this.genZone = (e.target as HTMLInputElement).value)}
          /></label>
        <label class="gen-row"><span>équipements</span>
          <input
            class="filter"
            placeholder="FOUR001, FOUR002"
            .value=${this.genEquipments}
            @input=${(e: Event) => (this.genEquipments = (e.target as HTMLInputElement).value)}
          /></label>
        <button
          class="btn primary gen-btn"
          ?disabled=${this.busy || !this.can('edit-model') || this.genTypeName.trim() === ''}
          @click=${() => this.onGenerateModel(book)}
        >⚙ Générer</button>
        ${unknown > 0
          ? html`<div class="gen-hint warn-inline">${unknown} signal(aux) « à qualifier » : leurs DPE seront créés sans config.</div>`
          : nothing}
        ${this.genWarnings.length > 0
          ? html`<ul class="gen-warnings">${this.genWarnings.map((w) => html`<li>${w}</li>`)}</ul>`
          : nothing}
      </div>
    `;
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
      const proposal = generateModelFromBook(book, {
        typeName: this.genTypeName.trim(),
        zone: this.genZone.trim() === '' ? undefined : this.genZone.trim(),
        equipments,
        deviceId: device?.id ?? book.id,
        // A template catalog is bound to the selected equipment's own connection.
        bindConnection: book.interface?.connection ?? device?.name,
        mode: book.interface?.protocol ?? device?.accessModes[0]
      });
      const merged = mergeProposal(workspace, proposal);
      await this.gateway.saveWorkspace(merged);
      this.workspace = merged;
      this.live = await this.gateway.liveSnapshot();
      this.recomputePlan();
      this.genWarnings = proposal.warnings;
      const configCount = Object.keys(proposal.configs).length;
      this.notice = `Modèle généré : type « ${proposal.type.typeName} », ${proposal.dps.length} DP, ${configCount} DPE configurés — voir l’onglet Contrôle.`;
    } catch (error) {
      this.genWarnings = [`Génération impossible : ${(error as Error).message}`];
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
    if (!ws) return html`<section class="grid-wrap"><div class="empty">Chargement…</div></section>`;
    const rows = this.gridRows(ws);
    return html`
      <section class="grid-wrap">
        <div class="grid-head-bar">
          <span>Modèle — <b>${ws.name}</b></span>
          <span class="chip">${ws.types.length} type(s)</span>
          <span class="chip">${ws.dps.length} DP</span>
          <span class="chip">${Object.keys(ws.configs).length} configs</span>
          <div class="spacer"></div>
          <button class="btn" @click=${this.onTestRead} ?disabled=${this.busy}>◉ Test-read</button>
        </div>
        <div class="grid-scroll">
          <table class="grid">
            <thead>
              <tr>
                <th>DPE</th><th>type</th><th>adresse</th><th>dir</th>
                <th>alarme</th><th>archive</th><th>plage</th><th>valeur live</th>
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
        <h2>Contrôle — check-in</h2>
        <div class="spacer"></div>
        <button class="btn" ?disabled=${this.busy || !plan?.items.length} @click=${() => this.doCheckin(true)}>Aperçu (dry-run)</button>
        <button class="btn primary" ?disabled=${this.busy || !this.can('checkin') || !plan?.items.length} @click=${() => this.doCheckin(false)}>
          ⇧ Check-in
        </button>
      </div>
      ${plan == null
        ? html`<div class="empty">Aucun plan.</div>`
        : plan.items.length === 0
          ? html`<div class="empty success">✓ Le projet est à jour — rien à appliquer.</div>`
          : html`
              <div class="diff-summary">
                ${this.summaryChip('create', plan)} ${this.summaryChip('update', plan)} ${this.summaryChip('delete', plan)}
                ${plan.items.some((i) => i.conflict) ? html`<span class="chip conflict">${plan.items.filter((i) => i.conflict).length} conflit(s)</span>` : nothing}
              </div>
              <div class="diff-scroll">
                <table class="grid">
                  <thead><tr><th>op</th><th>objet</th><th>nom</th><th>détail</th><th></th></tr></thead>
                  <tbody>
                    ${plan.items.map((item) => html`
                      <tr class=${item.conflict ? 'conflict-row' : ''}>
                        <td><span class="chip ${item.op}">${opLabel(item.op)}</span></td>
                        <td>${item.kind}</td>
                        <td class="mono">${item.name}</td>
                        <td class="mono soft">${item.detail ?? ''}</td>
                        <td>${item.conflict ? html`<span class="chip conflict">conflit</span>` : nothing}</td>
                      </tr>`)}
                  </tbody>
                </table>
              </div>
              ${plan.warnings.length > 0 ? html`<div class="warn-text">${plan.warnings.map((w) => html`<div>⚠ ${w}</div>`)}</div>` : nothing}
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
          ${report.dryRun ? 'Aperçu' : 'Résultat du check-in'} —
          <span class="chip new">${applied} appliqué(s)</span>
          ${skipped > 0 ? html`<span class="chip">${skipped} ignoré(s)</span>` : nothing}
          ${failed > 0 ? html`<span class="chip conflict">${failed} échec(s)</span>` : nothing}
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
    return html`<span class="chip ${op}">${n} ${opLabel(op)}</span>`;
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
      const fresh = await this.gateway.refreshBook(book.id);
      this.books = this.books.map((b) => (b.id === fresh.id ? fresh : b));
      const counts = this.roleTally(fresh);
      this.notice = `Règles appliquées sur « ${fresh.name} » : ${fresh.entries.length - counts.unknown}/${fresh.entries.length} signaux qualifiés.`;
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
      this.notice = `${count} signal(aux) qualifié(s) « ${SIGNAL_ROLE_LABEL[role]} ».`;
    } finally {
      this.busy = false;
    }
  }

  private async onRefreshBook(): Promise<void> {
    const bookId = this.selectedBookId;
    if (!bookId) return;
    this.busy = true;
    try {
      const fresh = await this.gateway.refreshBook(bookId);
      this.books = this.books.map((b) => (b.id === bookId ? fresh : b));
      this.notice = `Carnet « ${fresh.name} » rafraîchi : ${fresh.entries.length} signaux.`;
    } finally {
      this.busy = false;
    }
  }

  private onAddDevice(): void {
    this.notice = 'Ajout d’équipement : formulaire par protocole (à venir).';
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
        this.workspace = await this.gateway.getWorkspace();
        this.live = await this.gateway.liveSnapshot();
        this.recomputePlan();
        this.notice = 'Check-in appliqué.';
      }
    } catch (error) {
      this.notice = `Check-in impossible : ${(error as Error).message}`;
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

function opLabel(op: string): string {
  return op === 'create' ? 'créer' : op === 'update' ? 'modifier' : 'supprimer';
}

function dirLabel(direction: number): string {
  return direction === 1 ? 'OUT' : direction === 7 ? 'I/O' : 'IN';
}

if (!customElements.get('wui-eng-studio')) {
  customElements.define('wui-eng-studio', WuiEngStudio);
}
