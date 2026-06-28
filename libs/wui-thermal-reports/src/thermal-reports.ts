// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Thermal Treatment Reports (TTD) — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages per-charge thermal treatment reports ("rapports de traitement
 * thermique"): each report carries the charge identity (n° rapport/charge, OF,
 * pièce, matière), the treatment recipe (temperature paliers + tolerance band +
 * atmosphere, quench), a link to a furnace of the existing Machine Fleet 3D fleet
 * and the temperature datapoint whose NGA-archived history gives the *actual*
 * cycle curve, the quality-control results and a conformity verdict + validation.
 *
 * The page is a master/detail: a sortable CRUD table + KPI strip, and a full
 * report view (header, recipe, temperature curve actual-vs-setpoint, quality,
 * conformity, print). Each report is persisted as one datapoint
 * (`ThermalReport_Report`, Struct name+json — see {@link ReportStore}) via the
 * PARA REST API, with a transparent in-memory fallback when the backend is
 * unreachable.
 *
 * Built as a separate entry point (auto-discovered by build:pages) and loaded at
 * runtime via dynamic import; dependencies resolve via import maps.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import { FleetStore } from '@visuelconcept/wui-fleet-core/data/fleet-store.js';
import { buildDemoReports } from './thermal-reports/data/demo-reports.js';
import { exportCsv, exportJson, parseReports } from './thermal-reports/data/io.js';
import { ReportStore } from './thermal-reports/data/report-store.js';
import type { ReportStatus, ThermalReport } from './thermal-reports/types.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './thermal-reports/ui/tt-kpi-bar.js';
import './thermal-reports/ui/tt-report-detail.js';
import './thermal-reports/ui/tt-report-dialog.js';
import './thermal-reports/ui/tt-report-table.js';

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Apply a validate / reject transition, stamping validation + conformity. */
function applyStatus(report: ThermalReport, target: ReportStatus): ThermalReport {
  if (target === 'validated') {
    return {
      ...report,
      status: 'validated',
      validatedBy: report.operator || 'Opérateur',
      validatedAt: nowLocal(),
      conformity: report.conformity === 'pending' ? 'conform' : report.conformity
    };
  }
  if (target === 'rejected') {
    return {
      ...report,
      status: 'rejected',
      conformity: report.conformity === 'pending' ? 'nonconform' : report.conformity
    };
  }
  return { ...report, status: target };
}

export class WuiThermalReports extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private reports: ThermalReport[] = [];
  @state() private ateliers: Atelier[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Open report id (detail view); null shows the list. */
  @state() private selectedId: string | null = null;
  /** Editor target: an existing report, `null` for "new", or undefined = closed. */
  @state() private editing: ThermalReport | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new ReportStore();
  private readonly fleet = new FleetStore();

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Thermal Treatment Reports',
                fr: 'Rapports de traitement thermique',
                'de_AT.utf8': 'Wärmebehandlungsberichte'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.importError
            ? html`<div class="notice error"><ix-icon name="warning"></ix-icon>${this.importError}</div>`
            : nothing}
          ${this.offline
            ? html`<div class="notice">
                <ix-icon name="info"></ix-icon>Mode hors-ligne : modifications non persistées dans les
                datapoints (backend indisponible ou droits d'écriture manquants).
              </div>`
            : nothing}
          ${this.renderBody()}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<tt-report-dialog
            .report=${this.editing}
            .ateliers=${this.ateliers}
            @wui:save=${this.onSave}
            @wui:cancel=${this.closeDialog}
          ></tt-report-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${`Supprimer le rapport « ${this.reportName(this.deletingId)} » ?`}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderBody(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedReport();
    if (selected) {
      return html`<tt-report-detail
        .report=${selected}
        @wui:back=${() => (this.selectedId = null)}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:status=${(e: CustomEvent<{ id: string; target: ReportStatus }>) =>
          this.onStatus(e.detail.id, e.detail.target)}
      ></tt-report-detail>`;
    }
    return html`
      <div class="toolbar">
        <tt-kpi-bar class="grow" .reports=${this.reports}></tt-kpi-bar>
        <div class="actions">
          <ix-button variant="secondary" @click=${this.triggerImport}>
            <ix-icon name="upload" slot="icon"></ix-icon>Importer JSON
          </ix-button>
          <ix-button variant="secondary" ?disabled=${this.reports.length === 0} @click=${this.onExportJson}>
            <ix-icon name="download" slot="icon"></ix-icon>Export JSON
          </ix-button>
          <ix-button variant="secondary" ?disabled=${this.reports.length === 0} @click=${this.onExportCsv}>
            <ix-icon name="download" slot="icon"></ix-icon>Export CSV
          </ix-button>
          <ix-button @click=${this.openCreate}>
            <ix-icon name="plus" slot="icon"></ix-icon>Nouveau rapport
          </ix-button>
        </div>
      </div>
      <input class="import-input" type="file" accept="application/json,.json" hidden @change=${this.onImportFile} />
      ${this.renderList()}
    `;
  }

  private renderList(): TemplateResult {
    if (this.reports.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>Aucun rapport de traitement thermique pour l'instant.</ix-typography>
          <ix-button variant="secondary" @click=${this.generateDemo}>
            <ix-icon name="add" slot="icon"></ix-icon>Générer des rapports de démonstration
          </ix-button>
        </div>
      `;
    }
    return html`
      <tt-report-table
        .reports=${this.reports}
        @wui:open=${(e: CustomEvent<{ id: string }>) => (this.selectedId = e.detail.id)}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
      ></tt-report-table>
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.fleet.listAteliers();
    this.reports = await this.store.listReports();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private selectedReport(): ThermalReport | undefined {
    return this.selectedId ? this.reports.find((r) => r.id === this.selectedId) : undefined;
  }

  private openCreate(): void {
    this.editing = null;
  }

  private openEdit(id: string): void {
    this.editing = this.reports.find((r) => r.id === id) ?? null;
  }

  private closeDialog(): void {
    this.editing = undefined;
  }

  private async onSave(event: CustomEvent<ThermalReport>): Promise<void> {
    const report = event.detail;
    if (this.editing) {
      await this.store.saveReport(report);
      this.reports = this.reports.map((r) => (r.id === report.id ? report : r));
    } else {
      const created = await this.store.createReport(report);
      this.reports = [...this.reports, created];
    }
    this.editing = undefined;
    this.offline = this.store.offline;
  }

  private async onStatus(id: string, target: ReportStatus): Promise<void> {
    const current = this.reports.find((r) => r.id === id);
    if (!current) return;
    const next = applyStatus(current, target);
    await this.store.saveReport(next);
    this.reports = this.reports.map((r) => (r.id === id ? next : r));
    this.offline = this.store.offline;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.deleteReport(id);
    this.reports = this.reports.filter((r) => r.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.deletingId = null;
    this.offline = this.store.offline;
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    const created = await this.store.importDemo(buildDemoReports(this.ateliers));
    this.reports = this.offline ? await this.store.listReports() : [...this.reports, ...created];
    this.offline = this.store.offline;
    this.loading = false;
  }

  private onExportJson(): void {
    exportJson(this.reports);
  }

  private onExportCsv(): void {
    exportCsv(this.reports);
  }

  private triggerImport(): void {
    this.importError = '';
    this.importInput.value = '';
    this.importInput.click();
  }

  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let parsed: ThermalReport[];
    try {
      parsed = parseReports(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Import échoué.';
      return;
    }
    this.importError = '';
    const byId = new Map(this.reports.map((r) => [r.id, r]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        await this.store.saveReport(incoming);
        byId.set(incoming.id, incoming);
      } else {
        const created = await this.store.createReport(incoming);
        byId.set(created.id, created);
      }
    }
    this.reports = [...byId.values()];
    this.offline = this.store.offline;
  }

  private reportName(id: string): string {
    const report = this.reports.find((r) => r.id === id);
    return report ? `${report.reportNo} — ${report.charge}` : id;
  }
}

if (!customElements.get('wui-thermal-reports')) {
  customElements.define('wui-thermal-reports', WuiThermalReports);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 0 1rem 1rem;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    tt-report-table {
      flex: 1;
      min-height: 0;
    }
    tt-report-detail {
      flex: 1;
      min-height: 0;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 12%, transparent);
    }
    .notice.error {
      border-color: var(--theme-color-alarm);
      color: var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 12%, transparent);
    }
    .center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }
    .empty {
      color: var(--theme-color-soft-text);
    }
  `;
}
