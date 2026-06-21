/**
 * Report Templates — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages the reusable **report templates** consumed by the Reports page
 * ({@link ./report-builder.ts}): each template parameterises a report's
 * sections (text, comment, key/value fields, manual table, datapoint dataset +
 * aggregation, checklist) and a configurable state workflow with multi-level
 * signatures. Route: `/report-templates`.
 *
 * Each template is persisted as one datapoint (Struct name+json) via PARA REST,
 * with a transparent in-memory fallback when the backend is unreachable.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { buildDemoTemplates } from '@visuelconcept/wui-report-builder/data/demo.js';
import { exportTemplatesJson, parseTemplates } from '@visuelconcept/wui-report-builder/data/io.js';
import { TemplateStore } from '@visuelconcept/wui-report-builder/data/template-store.js';
import { blankTemplate, nowLocal, type ReportTemplate } from '@visuelconcept/wui-report-builder/types.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import '@visuelconcept/wui-report-builder/ui/rb-template-editor.js';
import '@visuelconcept/wui-report-builder/ui/rb-template-table.js';

const REPORTS_ROUTE = '/report-builder';

export class WuiReportTemplates extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private templates: ReportTemplate[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Editor target: existing template, `null` for new, `undefined` = closed. */
  @state() private editing: ReportTemplate | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';
  @state() private canPublish = false;
  @state() private signerName = '';

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new TemplateStore();
  private readonly user = this.resolveUser();
  private userSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.readUser();
    if (this.user) this.userSub = this.user.user$.subscribe(() => this.readUser());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.userSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Report Templates',
                fr: 'Modèles de rapports',
                'de_AT.utf8': 'Berichtsvorlagen'
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
                <ix-icon name="info"></ix-icon>Mode hors-ligne : modifications non persistées (backend
                indisponible ou droits d'écriture manquants).
              </div>`
            : nothing}
          ${this.renderBody()}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<rb-template-editor
            .template=${this.editing ?? blankTemplate()}
            .canEdit=${this.canPublish}
            @wui:save=${(e: CustomEvent<ReportTemplate>) => this.onSave(e.detail)}
            @wui:close=${() => (this.editing = undefined)}
          ></rb-template-editor>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${`Supprimer le modèle « ${this.templateName(this.deletingId)} » ?`}
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
    return html`
      <div class="toolbar">
        <span class="grow"></span>
        <div class="actions">
          <ix-button variant="secondary" @click=${() => this.dispatchEvent(new RouterEvent(REPORTS_ROUTE))}>
            <ix-icon name="list" slot="icon"></ix-icon>Rapports
          </ix-button>
          <ix-button variant="secondary" @click=${this.triggerImport}><ix-icon name="upload" slot="icon"></ix-icon>Importer</ix-button>
          <ix-button variant="secondary" ?disabled=${this.templates.length === 0} @click=${() => exportTemplatesJson(this.templates)}><ix-icon name="download" slot="icon"></ix-icon>JSON</ix-button>
          <ix-button ?disabled=${!this.canPublish} @click=${this.newTemplate}><ix-icon name="plus" slot="icon"></ix-icon>Nouveau modèle</ix-button>
        </div>
      </div>
      <input class="import-input" type="file" accept="application/json,.json" hidden @change=${this.onImportFile} />
      ${this.templates.length === 0
        ? html`<div class="center empty">
            <ix-typography>Aucun modèle.</ix-typography>
            <ix-button variant="secondary" ?disabled=${!this.canPublish} @click=${this.generateDemo}><ix-icon name="add" slot="icon"></ix-icon>Générer un modèle de démonstration</ix-button>
          </div>`
        : html`<rb-template-table
            .templates=${this.templates}
            .canEdit=${this.canPublish}
            @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openTemplate(e.detail.id)}
            @wui:duplicate=${(e: CustomEvent<{ id: string }>) => this.duplicate(e.detail.id)}
            @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
          ></rb-template-table>`}
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.templates = await this.store.list();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private newTemplate(): void {
    this.editing = null;
  }

  private openTemplate(id: string): void {
    this.editing = this.templates.find((t) => t.id === id) ?? null;
  }

  private async onSave(template: ReportTemplate): Promise<void> {
    const stamped: ReportTemplate = { ...template, updatedAt: nowLocal(), updatedBy: this.signerName };
    if (stamped.id) {
      await this.store.save(stamped);
      this.templates = this.templates.map((t) => (t.id === stamped.id ? stamped : t));
    } else {
      const created = await this.store.create(stamped);
      this.templates = [...this.templates, created];
    }
    this.offline = this.store.offline;
    this.editing = undefined;
  }

  private async duplicate(id: string): Promise<void> {
    const src = this.templates.find((t) => t.id === id);
    if (!src) return;
    const copy: ReportTemplate = { ...structuredClone(src), id: '', dp: '', name: `${src.name} (copie)` };
    const created = await this.store.create(copy);
    this.templates = [...this.templates, created];
    this.offline = this.store.offline;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.remove(id);
    this.templates = this.templates.filter((t) => t.id !== id);
    this.deletingId = null;
    this.offline = this.store.offline;
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    await this.store.importMany(buildDemoTemplates());
    this.templates = await this.store.list();
    this.offline = this.store.offline;
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
    let parsed: ReportTemplate[];
    try {
      parsed = parseTemplates(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Import échoué.';
      return;
    }
    this.importError = '';
    const byId = new Map(this.templates.map((t) => [t.id, t]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        await this.store.save(incoming);
        byId.set(incoming.id, incoming);
      } else {
        const created = await this.store.create({ ...incoming, id: '', dp: '' });
        byId.set(created.id, created);
      }
    }
    this.templates = [...byId.values()];
    this.offline = this.store.offline;
  }

  private templateName(id: string): string {
    return this.templates.find((t) => t.id === id)?.name ?? id;
  }

  private readUser(): void {
    const svc = this.user;
    this.canPublish = svc ? svc.canPublish === true : true;
    this.signerName = svc?.name ?? '';
  }

  private resolveUser(): WuiUserService | null {
    try {
      return container.resolve(WuiUserService);
    } catch {
      return null;
    }
  }
}

if (!customElements.get('wui-report-templates')) {
  customElements.define('wui-report-templates', WuiReportTemplates);
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
    rb-template-table {
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
