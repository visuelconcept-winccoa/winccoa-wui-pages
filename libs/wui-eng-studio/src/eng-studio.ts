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
  diffWorkspace,
  filterEntries,
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
  @state() private book: AddressBook | null = null;
  @state() private bookFilter = '';
  /** Filter for the signal table shown in the Devices panel's address book. */
  @state() private signalFilter = '';
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
      const selectedDeviceId = this.selectedDeviceId ?? devices[0]?.id ?? null;
      const book = selectedDeviceId ? await gateway.getAddressBook(selectedDeviceId) : null;
      const workspace = await gateway.getWorkspace();
      const live = await gateway.liveSnapshot();
      if (token !== this.loadToken) return; // superseded (e.g. by useDemo)
      this.roles = roles;
      this.devices = devices;
      this.selectedDeviceId = selectedDeviceId;
      this.book = book;
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
        <span class="chip proto">${this.protocolLabel(device)}</span>
      </button>
    `;
  }

  private protocolLabel(device: Device): string {
    const map: Record<string, string> = { opcua: 'OPC UA', s7: 'S7', s7plus: 'S7+', modbus: 'Modbus' };
    return map[device.protocol] ?? device.protocol;
  }

  // --- panel 1: devices + book ------------------------------------------------

  private renderDevicesPanel(): TemplateResult {
    const device = this.currentDevice();
    if (!device) return html`<div class="empty">Aucun équipement.</div>`;
    const book = this.book;
    return html`
      <div class="panel-head">
        <h2>${device.name}</h2>
        <span class="chip">${this.protocolLabel(device)}</span>
        <span class="chip"><span class="dot ${device.state}"></span>${device.state}</span>
        <div class="spacer"></div>
        ${this.can('manage-devices')
          ? html`<button class="btn primary" ?disabled=${this.busy} @click=${this.onRefreshBook}>⟳ Rafraîchir le carnet</button>`
          : nothing}
      </div>
      <div class="panel-scroll">
        <div class="device-grid">
          <section class="card">
            <div class="card-title">Connexion</div>
            <table class="kv">
              ${Object.entries(device.connection).map(
                ([k, v]) => html`<tr><td>${k}</td><td class="mono">${String(v)}</td></tr>`
              )}
              <tr><td>modes d'accès</td><td>${device.accessModes.map((m) => html`<span class="chip">${m}</span> `)}</td></tr>
              <tr><td>driver</td><td class="mono">${device.driverNumber ?? '—'}</td></tr>
            </table>
          </section>
          <section class="card">
            <div class="card-title">Carnet d'adresses</div>
            ${book
              ? html`
                  <table class="kv">
                    <tr><td>source</td><td>${book.provenance.kind}${book.provenance.file ? html` · <code>${book.provenance.file}</code>` : nothing}</td></tr>
                    <tr><td>généré</td><td class="mono">${book.provenance.generatedAt.replace('T', ' ').slice(0, 16)}</td></tr>
                    <tr><td>détail</td><td>${book.provenance.detail ?? '—'}</td></tr>
                    <tr><td>entrées</td><td><b>${book.entries.length}</b> signaux · ${book.types.length} type(s)</td></tr>
                    ${book.warnings.length > 0 ? html`<tr><td>avertissements</td><td class="warn-text">${book.warnings.length}</td></tr>` : nothing}
                  </table>
                `
              : html`<div class="empty small">Pas encore de carnet — ingérez un export SimaticML ou lancez un browse.</div>`}
          </section>
        </div>
        ${book && book.warnings.length > 0
          ? html`<section class="card warnings"><div class="card-title">Avertissements du générateur</div><ul>${book.warnings.map((w) => html`<li>${w}</li>`)}</ul></section>`
          : nothing}
        ${book ? this.renderDeviceSignals(book) : nothing}
      </div>
    `;
  }

  /** Signal table of the current device's address book (in the Devices panel). */
  private renderDeviceSignals(book: AddressBook): TemplateResult {
    const entries = filterEntries(book, this.signalFilter);
    const modes = this.currentDevice()?.accessModes ?? [];
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
          <span class="soft signals-count">${entries.length} / ${book.entries.length}</span>
        </div>
        <div class="signals-scroll">
          <table class="grid">
            <thead>
              <tr>
                <th>chemin</th><th>type</th><th>accès</th>
                <th>type source</th><th>adresses (par mode)</th><th>commentaire</th>
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

  private renderSignalRow(entry: BookEntry, deviceModes: string[]): TemplateResult {
    // Order the candidate addresses by the device's access modes first.
    const present = Object.keys(entry.addresses);
    const ordered = [...deviceModes.filter((m) => present.includes(m)), ...present.filter((m) => !deviceModes.includes(m))];
    return html`
      <tr>
        <td class="mono dpe">${entry.path}</td>
        <td>${entry.leafType}${entry.unmapped ? html` <span class="chip conflict" title="type non mappé">?</span>` : nothing}</td>
        <td><span class="chip acc">${entry.access}</span></td>
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
    const book = this.book;
    const entries = book ? filterEntries(book, this.bookFilter) : [];
    return html`
      <section class="browser">
        <div class="browser-head">
          <span>Carnet — ${this.currentDevice()?.name ?? ''}</span>
          <input
            class="filter"
            placeholder="filtrer…"
            .value=${this.bookFilter}
            @input=${(e: Event) => (this.bookFilter = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="browser-list">
          ${book == null
            ? html`<div class="empty small">Aucun carnet pour cet équipement.</div>`
            : entries.map((entry) => this.renderBookEntry(entry))}
        </div>
        <div class="browser-foot">${entries.length} / ${book?.entries.length ?? 0} signaux</div>
      </section>
    `;
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

  private async selectDevice(id: string): Promise<void> {
    this.selectedDeviceId = id;
    this.book = await this.gateway.getAddressBook(id);
  }

  private async onRefreshBook(): Promise<void> {
    if (!this.selectedDeviceId) return;
    this.busy = true;
    try {
      this.book = await this.gateway.refreshAddressBook(this.selectedDeviceId);
      this.notice = `Carnet rafraîchi : ${this.book.entries.length} signaux.`;
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
