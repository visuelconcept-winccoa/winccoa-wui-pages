// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Production Orders — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages a list of production orders (ordres de fabrication / OF): each order
 * carries identity/product, an atelier+machine assignment linked to the existing
 * Machine Fleet 3D fleet, a planned/actual schedule, a status and a priority.
 * The page offers a sortable CRUD table with inline status-workflow actions, a
 * KPI summary, a create/edit dialog, JSON/CSV import-export and a planning
 * (Gantt) view.
 *
 * The whole order list is persisted as a *single* WinCC OA datapoint
 * (`ProductionOrders_List`, a JSON array — see {@link OrderStore}), auto-created
 * via the PARA REST API, with a transparent in-memory fallback when the backend
 * is unreachable. When an order starts/ends, its number is best-effort pushed to
 * the assigned machine's `workOrderDp`/`operationDp` so the 3D bubble reflects
 * the active OF (see {@link ./production-orders/data/fleet-link.ts}).
 *
 * Built as a separate entry point (auto-discovered by build:pages) and loaded at
 * runtime via dynamic import; dependencies resolve via import maps.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import { FleetStore } from '@visuelconcept/wui-fleet-core/data/fleet-store.js';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { buildDemoOrders } from './production-orders/data/demo-orders.js';
import { clearOrderFromFleet, pushOrderToFleet } from './production-orders/data/fleet-link.js';
import { exportCsv, exportJson, parseOrders } from './production-orders/data/io.js';
import { OrderStore } from './production-orders/data/order-store.js';
import type { OrderStatus, ProductionOrder } from './production-orders/types.js';
import { applyTransition } from './production-orders/workflow.js';
import { MSG, confirmDeleteMsg, localize, localizeDir } from './production-orders/i18n.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './production-orders/ui/po-gantt.js';
import './production-orders/ui/po-kpi-bar.js';
import './production-orders/ui/po-order-dialog.js';
import './production-orders/ui/po-order-table.js';

type View = 'table' | 'gantt';
const ID_RADIX = 36;
const SLUG_MAX = 24;
/** Application-Security module id (= the page's routeId). */
const MODULE_ID = 'production-orders';

export class WuiProductionOrders extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private orders: ProductionOrder[] = [];
  @state() private ateliers: Atelier[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private view: View = 'table';
  /** Open editor target: an existing order, `null` for "new", or undefined = closed. */
  @state() private editing: ProductionOrder | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';

  /** Application-Security grants (open until an admin assigns groups). */
  @state() private canView = true;
  @state() private canEdit = true;

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new OrderStore();
  private readonly fleet = new FleetStore();
  private roleSub = new Subscription();

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Production Orders',
                fr: 'Ordres de production',
                'de_AT.utf8': 'Fertigungsaufträge'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.canView
            ? this.renderPageBody()
            : html`<div class="center empty">
                <ix-typography>${localizeDir(MSG.notice.roleForbidden)}</ix-typography>
              </div>`}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<po-order-dialog
            .order=${this.editing}
            .ateliers=${this.ateliers}
            @wui:save=${this.onSave}
            @wui:cancel=${this.closeDialog}
          ></po-order-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteMsg(this.orderName(this.deletingId))}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = new Subscription();
    this.roleSub.add(
      hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.canView = granted))
    );
    this.roleSub.add(
      hasRole$(MODULE_ID, 'edit').subscribe((granted) => {
        this.canEdit = granted;
        if (!granted) {
          // Drop any live edit affordance when the grant is revoked.
          this.editing = undefined;
          this.deletingId = null;
        }
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  // eslint-disable-next-line max-lines-per-function -- single toolbar + content template
  private renderPageBody(): TemplateResult {
    return html`
      <div class="toolbar">
        <po-kpi-bar class="grow" .orders=${this.orders}></po-kpi-bar>
        <div class="actions">
          <div class="seg">
            <ix-button
              variant=${this.view === 'table' ? 'primary' : 'secondary'}
              @click=${() => (this.view = 'table')}
            >
              <ix-icon name="table" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.table)}
            </ix-button>
            <ix-button
              variant=${this.view === 'gantt' ? 'primary' : 'secondary'}
              @click=${() => (this.view = 'gantt')}
            >
              <ix-icon name="barchart-horizontal" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.planning)}
            </ix-button>
          </div>
          ${this.canEdit
            ? html`<ix-button variant="secondary" @click=${this.triggerImport}>
                <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.importJson)}
              </ix-button>`
            : nothing}
          <ix-button
            variant="secondary"
            ?disabled=${this.orders.length === 0}
            @click=${this.onExportJson}
          >
            <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.exportJson)}
          </ix-button>
          <ix-button
            variant="secondary"
            ?disabled=${this.orders.length === 0}
            @click=${this.onExportCsv}
          >
            <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.exportCsv)}
          </ix-button>
          ${this.canEdit
            ? html`<ix-button @click=${this.openCreate}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.newOrder)}
              </ix-button>`
            : nothing}
        </div>
      </div>
      <input
        class="import-input"
        type="file"
        accept="application/json,.json"
        hidden
        @change=${this.onImportFile}
      />

      ${this.importError
        ? html`<div class="notice error">
            <ix-icon name="warning"></ix-icon>${this.importError}
          </div>`
        : nothing}
      ${this.offline
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>${localizeDir(MSG.notice.offline)}
          </div>`
        : nothing}
      ${this.renderContent()}
    `;
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.orders.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>${localizeDir(MSG.empty.none)}</ix-typography>
          ${this.canEdit
            ? html`<ix-button variant="secondary" @click=${this.generateDemo}>
                <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.empty.generateDemo)}
              </ix-button>`
            : nothing}
        </div>
      `;
    }
    if (this.view === 'gantt') {
      return html`<po-gantt .orders=${this.orders}></po-gantt>`;
    }
    return html`
      <po-order-table
        .orders=${this.orders}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
        @wui:status=${(e: CustomEvent<{ id: string; target: OrderStatus }>) =>
          this.onStatus(e.detail.id, e.detail.target)}
      ></po-order-table>
    `;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.fleet.listAteliers();
    this.orders = await this.store.load();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async persist(): Promise<void> {
    await this.store.saveAll(this.orders);
    this.offline = this.store.offline;
  }

  private openCreate(): void {
    this.editing = null;
  }

  private openEdit(id: string): void {
    this.editing = this.orders.find((o) => o.id === id) ?? null;
  }

  private closeDialog(): void {
    this.editing = undefined;
  }

  private async onSave(event: CustomEvent<ProductionOrder>): Promise<void> {
    const order = event.detail;
    if (this.editing) {
      this.orders = this.orders.map((o) => (o.id === order.id ? order : o));
    } else {
      const created: ProductionOrder = { ...order, id: this.newId(order.orderNo) };
      this.orders = [...this.orders, created];
    }
    this.editing = undefined;
    await this.persist();
  }

  private async onStatus(id: string, target: OrderStatus): Promise<void> {
    const current = this.orders.find((o) => o.id === id);
    if (!current) return;
    const next = applyTransition(current, target);
    this.orders = this.orders.map((o) => (o.id === id ? next : o));
    await this.persist();
    // Best-effort: reflect the active OF on the assigned fleet machine.
    if (target === 'running') void pushOrderToFleet(this.ateliers, next);
    else if (target === 'done' || target === 'cancelled') void clearOrderFromFleet(this.ateliers, next);
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    this.orders = this.orders.filter((o) => o.id !== id);
    this.deletingId = null;
    await this.persist();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    this.orders = buildDemoOrders(this.ateliers);
    await this.persist();
    this.loading = false;
  }

  private onExportJson(): void {
    exportJson(this.orders);
  }

  private onExportCsv(): void {
    exportCsv(this.orders);
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
    let parsed: ProductionOrder[];
    try {
      parsed = parseOrders(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.empty.importFailed);
      return;
    }
    this.importError = '';
    const byId = new Map(this.orders.map((o) => [o.id, o]));
    for (const incoming of parsed) {
      const id = incoming.id || this.newId(incoming.orderNo);
      byId.set(id, { ...incoming, id });
    }
    this.orders = [...byId.values()];
    await this.persist();
  }

  private newId(orderNo: string): string {
    const base =
      orderNo
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/(^-|-$)/g, '')
        .slice(0, SLUG_MAX) || 'of';
    return `${base}-${Date.now().toString(ID_RADIX)}`;
  }

  private orderName(id: string): string {
    const order = this.orders.find((o) => o.id === id);
    return order ? `${order.orderNo} — ${order.product}` : id;
  }
}

if (!customElements.get('wui-production-orders')) {
  customElements.define('wui-production-orders', WuiProductionOrders);
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
    .seg {
      display: flex;
      gap: 0.25rem;
      margin-right: 0.25rem;
    }
    po-order-table,
    po-gantt {
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
