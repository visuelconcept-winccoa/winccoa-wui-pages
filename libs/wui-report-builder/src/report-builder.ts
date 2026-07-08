// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reports — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages **report instances** created from the reusable templates edited on the
 * separate Templates page ({@link ./report-templates.ts}). Each report has its
 * own URL: `/report-builder` lists them, `/report-builder/:reportid` opens one
 * (so a report is shareable/deep-linkable). Fill the data, recompute dataset
 * aggregations from the archives, and validate through the template's signature
 * workflow (each signature records the connected user + timestamp, gated by the
 * publish permission and an optional checklist). A report in a final state is
 * locked read-only.
 *
 * Each report is persisted as one datapoint (Struct name+json) via PARA REST,
 * with a transparent in-memory fallback when the backend is unreachable.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { MSG, confirmDeleteReportMsg, localize, localizeDir } from './i18n.js';
import { buildDemoReports, buildDemoTemplates } from './data/demo.js';
import { exportReportsCsv, exportReportsJson, parseReports } from './data/io.js';
import { ReportStore } from './data/report-store.js';
import { TemplateStore } from './data/template-store.js';
import type { Report, ReportTemplate } from './types.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './ui/rb-kpi-bar.js';
import './ui/rb-report-detail.js';
import './ui/rb-report-dialog.js';
import './ui/rb-report-table.js';

const REPORTS_ROUTE = '/report-builder';
const TEMPLATES_ROUTE = '/report-templates';
const MODULE_ID = 'report-builder';

export class WuiReportBuilder extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/report-builder/:reportid` → open that report (list when absent). */
  @property({ attribute: 'reportid' }) reportId = '';

  @state() private reports: Report[] = [];
  @state() private templates: ReportTemplate[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private creatingReport = false;
  @state() private deletingId: string | null = null;
  @state() private importError = '';
  @state() private canPublish = false;
  @state() private signerName = '';
  @state() private signerId = '';

  /** Application-Security grants (open until a group is assigned in /app-security). */
  @state() private roleView = true;
  @state() private roleFill = true;
  @state() private roleSign = true;

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly reportStore = new ReportStore();
  private readonly templateStore = new TemplateStore();
  private readonly user = this.resolveUser();
  private userSub = new Subscription();
  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.readUser();
    if (this.user) this.userSub = this.user.user$.subscribe(() => this.readUser());
    // Application Security: declare this module's roles and follow the grants live.
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = new Subscription();
    this.roleSub.add(hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.roleView = granted)));
    this.roleSub.add(
      hasRole$(MODULE_ID, 'fill').subscribe((granted) => {
        this.roleFill = granted;
        if (!granted) {
          // Drop out of a live creation/deletion flow when the grant is revoked.
          this.creatingReport = false;
          this.deletingId = null;
        }
      })
    );
    this.roleSub.add(hasRole$(MODULE_ID, 'sign').subscribe((granted) => (this.roleSign = granted)));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.userSub.unsubscribe();
    this.roleSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Reports', fr: 'Rapports', 'de_AT.utf8': 'Berichte' }
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
                <ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}
              </div>`
            : nothing}
          ${this.renderBody()}
        </div>
      </div>

      ${this.creatingReport
        ? html`<rb-report-dialog
            .templates=${this.templates}
            @wui:create=${(e: CustomEvent<Report>) => this.onReportCreate(e.detail)}
            @wui:cancel=${() => (this.creatingReport = false)}
          ></rb-report-dialog>`
        : nothing}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteReportMsg(this.reportName(this.deletingId))}
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
    if (!this.roleView) return this.renderForbidden();
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedReport();
    if (selected) {
      return html`<rb-report-detail
        .report=${selected}
        .canPublish=${this.canPublish}
        .canFill=${this.roleFill}
        .canSign=${this.roleSign}
        signerName=${this.signerName}
        signerId=${this.signerId}
        @wui:back=${this.goToList}
        @wui:save=${(e: CustomEvent<Report>) => this.onReportSave(e.detail)}
      ></rb-report-detail>`;
    }
    return html`
      <div class="toolbar">
        <rb-kpi-bar class="grow" .reports=${this.reports}></rb-kpi-bar>
        <div class="actions">
          <ix-button variant="secondary" @click=${() => this.dispatchEvent(new RouterEvent(TEMPLATES_ROUTE))}>
            <ix-icon name="document" slot="icon"></ix-icon>${localizeDir(MSG.page.templates)}
          </ix-button>
          ${this.roleFill
            ? html`<ix-button variant="secondary" @click=${this.triggerImport}><ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.page.import)}</ix-button>`
            : nothing}
          <ix-button variant="secondary" ?disabled=${this.reports.length === 0} @click=${() => exportReportsJson(this.reports)}><ix-icon name="download" slot="icon"></ix-icon>JSON</ix-button>
          <ix-button variant="secondary" ?disabled=${this.reports.length === 0} @click=${() => exportReportsCsv(this.reports)}><ix-icon name="download" slot="icon"></ix-icon>CSV</ix-button>
          ${this.roleFill
            ? html`<ix-button ?disabled=${this.templates.length === 0} @click=${() => (this.creatingReport = true)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.page.newReport)}</ix-button>`
            : nothing}
        </div>
      </div>
      <input class="import-input" type="file" accept="application/json,.json" hidden @change=${this.onImportFile} />
      ${this.reports.length === 0 ? this.renderEmpty() : html`<rb-report-table
            .reports=${this.reports}
            .canEdit=${this.canPublish && this.roleFill}
            @wui:open=${(e: CustomEvent<{ id: string }>) => this.open(e.detail.id)}
            @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
          ></rb-report-table>`}
    `;
  }

  private renderForbidden(): TemplateResult {
    return html`<div class="center empty">
      <ix-typography>${localizeDir(MSG.page.roleForbidden)}</ix-typography>
    </div>`;
  }

  private renderEmpty(): TemplateResult {
    return html`<div class="center empty">
      <ix-typography>${localizeDir(MSG.page.empty)}</ix-typography>
      ${this.templates.length === 0
        ? html`<ix-typography>${localizeDir(MSG.page.emptyNoTemplate)}</ix-typography>`
        : nothing}
      ${this.roleFill
        ? html`<ix-button variant="secondary" @click=${this.generateDemo}><ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.page.generateDemo)}</ix-button>`
        : nothing}
    </div>`;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.templates = await this.templateStore.list();
    this.reports = await this.reportStore.list();
    this.offline = this.templateStore.offline || this.reportStore.offline;
    this.loading = false;
  }

  private selectedReport(): Report | undefined {
    return this.reportId ? this.reports.find((r) => r.id === this.reportId) : undefined;
  }

  private open(id: string): void {
    this.dispatchEvent(new RouterEvent(`${REPORTS_ROUTE}/${id}`));
  }

  private readonly goToList = (): void => {
    this.dispatchEvent(new RouterEvent(REPORTS_ROUTE));
  };

  private async onReportCreate(report: Report): Promise<void> {
    const created = await this.reportStore.create(report);
    this.reports = [...this.reports, created];
    this.creatingReport = false;
    this.offline = this.reportStore.offline;
    this.open(created.id);
  }

  private async onReportSave(report: Report): Promise<void> {
    await this.reportStore.save(report);
    this.reports = this.reports.map((r) => (r.id === report.id ? report : r));
    this.offline = this.reportStore.offline;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.reportStore.remove(id);
    this.reports = this.reports.filter((r) => r.id !== id);
    this.deletingId = null;
    this.offline = this.reportStore.offline;
    if (this.reportId === id) this.goToList();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    if (this.templates.length === 0) await this.templateStore.importMany(buildDemoTemplates());
    await this.reportStore.importMany(buildDemoReports());
    this.templates = await this.templateStore.list();
    this.reports = await this.reportStore.list();
    this.offline = this.templateStore.offline || this.reportStore.offline;
    this.loading = false;
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
    let parsed: Report[];
    try {
      parsed = parseReports(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.io.importFailed);
      return;
    }
    this.importError = '';
    const byId = new Map(this.reports.map((r) => [r.id, r]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        await this.reportStore.save(incoming);
        byId.set(incoming.id, incoming);
      } else {
        const created = await this.reportStore.create({ ...incoming, id: '', dp: '' });
        byId.set(created.id, created);
      }
    }
    this.reports = [...byId.values()];
    this.offline = this.reportStore.offline;
  }

  private reportName(id: string): string {
    const r = this.reports.find((x) => x.id === id);
    return r?.reportNo || r?.title || id;
  }

  private readUser(): void {
    const svc = this.user;
    this.canPublish = svc ? svc.canPublish === true : true;
    this.signerName = svc?.name ?? '';
    this.signerId = svc?.id == null ? '' : String(svc.id);
  }

  private resolveUser(): WuiUserService | null {
    try {
      return container.resolve(WuiUserService);
    } catch {
      return null;
    }
  }
}

if (!customElements.get('wui-report-builder')) {
  customElements.define('wui-report-builder', WuiReportBuilder);
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
      margin-bottom: 0.5rem;
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
    rb-report-table {
      flex: 1;
      min-height: 0;
    }
    rb-report-detail {
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
