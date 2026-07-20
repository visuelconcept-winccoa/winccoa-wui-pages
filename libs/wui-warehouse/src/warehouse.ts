// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Warehouse Management System — standalone WinCC OA WebUI page (Lit + iX).
 *
 * Five tabs:
 *  - **Plan**: 2D map of zones/locations coloured by occupancy; click a location
 *    to inspect its contents.
 *  - **Stock**: KPI tiles + filterable stock table with add/adjust/remove.
 *  - **Zones**: CRUD of storage zones and their locations (incl. plan layout).
 *  - **Products**: CRUD of the product catalog (references, units, thresholds).
 *  - **Inventory**: stock-count campaigns — snapshot → count → variance →
 *    validate (writes counts back to stock).
 *
 * Persistence: zones/locations/products/campaigns as JSON-in-DP (`DpJsonStore`),
 * stock quantities in the dedicated `WMS_Stock` datapoint type (see `data/`).
 * All writes ride the PARA REST backend; role gating follows Application Security
 * (`registerModuleRoles` + `hasRole$`, module id `warehouse`).
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import appSecurityRoles from './app-security.roles.json';
import { MSG, localize, localizeDir } from './warehouse/i18n.js';
import { pageStyles } from './warehouse/page-styles.js';
import { locationUnits, occupancy, stockStatus } from './warehouse/model.js';
import { inventoryStore, loadConfig, locationStore, productStore, seedConfigIfEmpty, zoneStore } from './warehouse/data/stores.js';
import { seedStockIfEmpty, stockStore } from './warehouse/data/stock-store.js';
import { campaignFields, locationFields, productFields, stockFields, zoneFields } from './warehouse/forms.js';
import type { InventoryCampaign, InventoryLine, Product, StockCell, StockStatus, StorageLocation, Zone } from './warehouse/types.js';
import type { CountEntry } from './warehouse/ui/wh-inventory.js';
import type { EntityDraft, FieldDef } from './warehouse/ui/wh-entity-dialog.js';
import './warehouse/ui/wh-entity-dialog.js';
import './warehouse/ui/wh-plan.js';
import './warehouse/ui/wh-stock.js';
import './warehouse/ui/wh-zones.js';
import './warehouse/ui/wh-products.js';
import './warehouse/ui/wh-inventory.js';

const MODULE_ID = 'warehouse';

type Tab = 'plan' | 'stock' | 'zones' | 'products' | 'inventory';
type DialogKind = 'zone' | 'location' | 'product' | 'stock' | 'campaign';
type ConfirmKind = 'delzone' | 'delloc' | 'delproduct' | 'delcampaign' | 'validate';

interface DialogState {
  kind: DialogKind;
  heading: string;
  fields: FieldDef[];
  value: EntityDraft;
  /** Id of the entity being edited (undefined = create). */
  editId?: string;
}

interface ConfirmState {
  kind: ConfirmKind;
  id: string;
  message: string;
}

function num(draft: EntityDraft, key: string, fallback = 0): number {
  const v = draft[key];
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(draft: EntityDraft, key: string, fallback = ''): string {
  const v = draft[key];
  return v == null ? fallback : String(v);
}

export class WuiWarehouse extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private tab: Tab = 'plan';
  @state() private zones: Zone[] = [];
  @state() private locations: StorageLocation[] = [];
  @state() private products: Product[] = [];
  @state() private campaigns: InventoryCampaign[] = [];
  @state() private stock: StockCell[] = [];
  @state() private offline = false;
  @state() private loading = true;
  @state() private selectedId = '';
  @state() private openCampaignId = '';
  @state() private roleView = true;
  @state() private roleEdit = true;
  @state() private roleAdjust = true;
  @state() private roleInventory = true;
  @state() private dialog: DialogState | null = null;
  @state() private confirm: ConfirmState | null = null;

  private permSub = new Subscription();

  private get openCampaign(): InventoryCampaign | null {
    return this.campaigns.find((c) => c.id === this.openCampaignId) ?? null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.permSub.add(hasRole$(MODULE_ID, 'view').subscribe((g) => (this.roleView = g)));
    this.permSub.add(hasRole$(MODULE_ID, 'edit-config').subscribe((g) => (this.roleEdit = g)));
    this.permSub.add(hasRole$(MODULE_ID, 'adjust-stock').subscribe((g) => (this.roleAdjust = g)));
    this.permSub.add(hasRole$(MODULE_ID, 'inventory').subscribe((g) => (this.roleInventory = g)));
    void this.init();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
    this.permSub = new Subscription();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Warehouse', 'fr.utf8': "Gestion d'entrepôt", 'de_AT.utf8': 'Lagerverwaltung' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.offline ? html`<div class="offline">${localizeDir(MSG.common.offline)}</div>` : nothing}
          ${this.roleView ? this.renderContent() : html`<div class="locked">${localize(MSG.common.offline)}</div>`}
        </div>
      </div>
      ${this.renderDialog()} ${this.renderConfirm()}
    `;
  }

  private renderContent(): TemplateResult {
    return html`
      <div class="tabs">
        ${this.tabBtn('plan', MSG.tabs.plan)} ${this.tabBtn('stock', MSG.tabs.stock)} ${this.tabBtn('zones', MSG.tabs.zones)}
        ${this.tabBtn('products', MSG.tabs.products)} ${this.tabBtn('inventory', MSG.tabs.inventory)}
      </div>
      <div class="panel">${this.loading ? nothing : this.renderTab()}</div>
    `;
  }

  private renderTab(): TemplateResult {
    switch (this.tab) {
      case 'plan': {
        return this.renderPlan();
      }
      case 'stock': {
        return this.renderStock();
      }
      case 'zones': {
        return this.renderZones();
      }
      case 'products': {
        return this.renderProducts();
      }
      default: {
        return this.renderInventory();
      }
    }
  }

  private renderPlan(): TemplateResult {
    return html`
      <div class="plan-wrap">
        <wh-plan
          .zones=${this.zones}
          .locations=${this.locations}
          .stock=${this.stock}
          .selectedId=${this.selectedId}
          @wui:select=${(e: CustomEvent<{ locationId: string }>) => (this.selectedId = e.detail.locationId)}
        ></wh-plan>
        ${this.renderLocationDetail()}
      </div>
    `;
  }

  private renderLocationDetail(): TemplateResult {
    const loc = this.locations.find((l) => l.id === this.selectedId);
    if (!loc) return html`<div class="detail muted">${localizeDir(MSG.plan.noSelection)}<br /><small>${localizeDir(MSG.plan.hint)}</small></div>`;
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    const units = locationUnits(this.stock, loc.id);
    const pct = Math.round(occupancy(units, loc.capacity) * 100);
    const cells = this.stock.filter((c) => c.locationId === loc.id);
    return html`
      <div class="detail">
        <div class="detail-head" style="--accent:${zone?.color ?? 'var(--theme-color-primary)'}">
          <span class="dot"></span>
          <span class="strong">${loc.code}</span>
          <span class="muted">${zone ? `${zone.code} · ${zone.name}` : ''}</span>
        </div>
        <div class="detail-meta">
          <span>${localizeDir(MSG.plan.capacity)}: <b>${loc.capacity > 0 ? loc.capacity : '∞'}</b></span>
          <span>${localizeDir(MSG.plan.occupancy)}: <b>${loc.capacity > 0 ? `${pct}%` : `${units}`}</b></span>
        </div>
        <div class="subhead">${localizeDir(MSG.plan.contents)}</div>
        ${cells.length === 0
          ? html`<div class="muted">—</div>`
          : cells.map((c) => {
              const product = this.products.find((p) => p.id === c.productId);
              const status = stockStatus(c.quantity, product);
              return html`<div class="content-row">
                <span>${product?.name ?? c.productId} <span class="muted mono">${product?.ref ?? ''}</span></span>
                <b class="${this.contentClass(status)}">${c.quantity.toLocaleString()} ${product?.unit ?? ''}</b>
              </div>`;
            })}
      </div>
    `;
  }

  private contentClass(status: StockStatus): string {
    if (status === 'under') return 'warn';
    return status === 'over' ? 'alarm' : '';
  }

  private renderStock(): TemplateResult {
    return html`<wh-stock
      .stock=${this.stock}
      .products=${this.products}
      .locations=${this.locations}
      .zones=${this.zones}
      .canAdjust=${this.roleAdjust}
      @wui:add=${() => this.openStockDialog()}
      @wui:edit=${(e: CustomEvent<{ productId: string; locationId: string; quantity: number }>) => this.openStockDialog(e.detail)}
      @wui:remove=${(e: CustomEvent<{ id: string }>) => void this.removeStock(e.detail.id)}
    ></wh-stock>`;
  }

  private renderZones(): TemplateResult {
    return html`<wh-zones
      .zones=${this.zones}
      .locations=${this.locations}
      .stock=${this.stock}
      .canEdit=${this.roleEdit}
      @wui:addzone=${() => this.openZoneDialog()}
      @wui:editzone=${(e: CustomEvent<{ id: string }>) => this.openZoneDialog(e.detail.id)}
      @wui:delzone=${(e: CustomEvent<{ id: string }>) => this.ask('delzone', e.detail.id, localize(MSG.zones.deleteZone))}
      @wui:addloc=${(e: CustomEvent<{ zoneId: string }>) => this.openLocationDialog(undefined, e.detail.zoneId)}
      @wui:editloc=${(e: CustomEvent<{ id: string }>) => this.openLocationDialog(e.detail.id)}
      @wui:delloc=${(e: CustomEvent<{ id: string }>) => this.ask('delloc', e.detail.id, localize(MSG.zones.deleteLocation))}
    ></wh-zones>`;
  }

  private renderProducts(): TemplateResult {
    return html`<wh-products
      .products=${this.products}
      .stock=${this.stock}
      .canEdit=${this.roleEdit}
      @wui:add=${() => this.openProductDialog()}
      @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openProductDialog(e.detail.id)}
      @wui:remove=${(e: CustomEvent<{ id: string }>) => this.ask('delproduct', e.detail.id, localize(MSG.products.deleteProduct))}
    ></wh-products>`;
  }

  private renderInventory(): TemplateResult {
    return html`<wh-inventory
      .campaigns=${this.campaigns}
      .openCampaign=${this.openCampaign}
      .products=${this.products}
      .locations=${this.locations}
      .zones=${this.zones}
      .canManage=${this.roleInventory}
      @wui:new=${() => this.openCampaignDialog()}
      @wui:open=${(e: CustomEvent<{ id: string }>) => (this.openCampaignId = e.detail.id)}
      @wui:back=${() => (this.openCampaignId = '')}
      @wui:del=${(e: CustomEvent<{ id: string }>) => this.ask('delcampaign', e.detail.id, localize(MSG.inventory.deleteCampaign))}
      @wui:save=${(e: CustomEvent<{ counts: CountEntry[] }>) => void this.saveCounts(e.detail.counts)}
      @wui:valid=${(e: CustomEvent<{ id: string }>) => this.ask('validate', e.detail.id, localize(MSG.inventory.validateConfirm))}
    ></wh-inventory>`;
  }

  private renderDialog(): TemplateResult {
    if (!this.dialog) return html``;
    return html`<wh-entity-dialog
      heading=${this.dialog.heading}
      .fields=${this.dialog.fields}
      .value=${this.dialog.value}
      @wui:save=${(e: CustomEvent<EntityDraft>) => void this.onDialogSave(e.detail)}
      @wui:cancel=${() => (this.dialog = null)}
    ></wh-entity-dialog>`;
  }

  private renderConfirm(): TemplateResult {
    if (!this.confirm) return html``;
    return html`<wui-confirm-dialog
      message=${this.confirm.message}
      @wui:confirm=${() => void this.onConfirm()}
      @wui:cancel=${() => (this.confirm = null)}
    ></wui-confirm-dialog>`;
  }

  private tabBtn(tab: Tab, label: typeof MSG.tabs.plan): TemplateResult {
    return html`<ix-button variant=${this.tab === tab ? 'primary' : 'secondary'} @click=${() => (this.tab = tab)}>
      ${localizeDir(label)}
    </ix-button>`;
  }

  // --- data --------------------------------------------------------------------

  private async init(): Promise<void> {
    this.loading = true;
    await seedConfigIfEmpty();
    await seedStockIfEmpty();
    await this.reload();
    this.loading = false;
  }

  private async reload(): Promise<void> {
    const config = await loadConfig();
    this.zones = config.zones;
    this.locations = config.locations;
    this.products = config.products;
    this.campaigns = config.campaigns;
    this.stock = await stockStore.list();
    this.offline = config.offline || stockStore.offline;
  }

  // --- dialogs -----------------------------------------------------------------

  private openZoneDialog(editId?: string): void {
    const existing = editId ? this.zones.find((z) => z.id === editId) : undefined;
    const value: EntityDraft = existing
      ? { name: existing.name, code: existing.code, color: existing.color, x: existing.x, y: existing.y, w: existing.w, h: existing.h, description: existing.description }
      : { name: '', code: '', color: '#3b82f6', x: 1, y: 1, w: 12, h: 7, description: '' };
    this.dialog = { kind: 'zone', editId, heading: localize(existing ? MSG.dialogTitles.editZone : MSG.dialogTitles.newZone), fields: zoneFields(), value };
  }

  private openLocationDialog(editId?: string, zoneId?: string): void {
    const existing = editId ? this.locations.find((l) => l.id === editId) : undefined;
    const value: EntityDraft = existing
      ? { zoneId: existing.zoneId, code: existing.code, label: existing.label, type: existing.type, capacity: existing.capacity, x: existing.x, y: existing.y, w: existing.w, h: existing.h }
      : { zoneId: zoneId ?? this.zones[0]?.id ?? '', code: '', label: '', type: 'rack', capacity: 100, x: 0.5, y: 0.5, w: 5, h: 3 };
    this.dialog = { kind: 'location', editId, heading: localize(existing ? MSG.dialogTitles.editLocation : MSG.dialogTitles.newLocation), fields: locationFields(this.zones), value };
  }

  private openProductDialog(editId?: string): void {
    const existing = editId ? this.products.find((p) => p.id === editId) : undefined;
    const value: EntityDraft = existing
      ? { ref: existing.ref, name: existing.name, category: existing.category, unit: existing.unit, minQty: existing.minQty, maxQty: existing.maxQty }
      : { ref: '', name: '', category: '', unit: 'pcs', minQty: 0, maxQty: 0 };
    this.dialog = { kind: 'product', editId, heading: localize(existing ? MSG.dialogTitles.editProduct : MSG.dialogTitles.newProduct), fields: productFields(), value };
  }

  private openStockDialog(edit?: { productId: string; locationId: string; quantity: number }): void {
    const value: EntityDraft = edit
      ? { product: edit.productId, location: edit.locationId, quantity: edit.quantity }
      : { product: this.products[0]?.id ?? '', location: this.locations[0]?.id ?? '', quantity: 0 };
    this.dialog = { kind: 'stock', heading: localize(MSG.dialogTitles.addStock), fields: stockFields(this.products, this.locations, edit != null), value };
  }

  private openCampaignDialog(): void {
    const value: EntityDraft = { name: '', zoneId: '' };
    this.dialog = { kind: 'campaign', heading: localize(MSG.dialogTitles.newCampaign), fields: campaignFields(this.zones), value };
  }

  private async onDialogSave(draft: EntityDraft): Promise<void> {
    const dialog = this.dialog;
    this.dialog = null;
    if (!dialog) return;
    switch (dialog.kind) {
      case 'zone': {
        await this.saveZone(draft, dialog.editId);
        break;
      }
      case 'location': {
        await this.saveLocation(draft, dialog.editId);
        break;
      }
      case 'product': {
        await this.saveProduct(draft, dialog.editId);
        break;
      }
      case 'stock': {
        await this.saveStock(draft);
        break;
      }
      default: {
        await this.createCampaign(draft);
      }
    }
    await this.reload();
  }

  private async saveZone(draft: EntityDraft, editId?: string): Promise<void> {
    const base: Zone = {
      id: editId ?? '',
      name: str(draft, 'name'),
      code: str(draft, 'code'),
      description: str(draft, 'description'),
      color: str(draft, 'color', '#3b82f6'),
      x: num(draft, 'x', 1),
      y: num(draft, 'y', 1),
      w: num(draft, 'w', 12),
      h: num(draft, 'h', 7)
    };
    const existing = editId ? this.zones.find((z) => z.id === editId) : undefined;
    await (existing ? zoneStore.save({ ...existing, ...base, id: existing.id }) : zoneStore.create(base));
  }

  private async saveLocation(draft: EntityDraft, editId?: string): Promise<void> {
    const base: StorageLocation = {
      id: editId ?? '',
      zoneId: str(draft, 'zoneId'),
      code: str(draft, 'code'),
      label: str(draft, 'label'),
      type: (str(draft, 'type', 'rack') as StorageLocation['type']),
      capacity: num(draft, 'capacity', 0),
      x: num(draft, 'x', 0.5),
      y: num(draft, 'y', 0.5),
      w: num(draft, 'w', 5),
      h: num(draft, 'h', 3)
    };
    const existing = editId ? this.locations.find((l) => l.id === editId) : undefined;
    await (existing ? locationStore.save({ ...existing, ...base, id: existing.id }) : locationStore.create(base));
  }

  private async saveProduct(draft: EntityDraft, editId?: string): Promise<void> {
    const base: Product = {
      id: editId ?? '',
      ref: str(draft, 'ref'),
      name: str(draft, 'name'),
      category: str(draft, 'category'),
      unit: str(draft, 'unit', 'pcs'),
      minQty: num(draft, 'minQty', 0),
      maxQty: num(draft, 'maxQty', 0)
    };
    const existing = editId ? this.products.find((p) => p.id === editId) : undefined;
    await (existing ? productStore.save({ ...existing, ...base, id: existing.id }) : productStore.create(base));
  }

  private async saveStock(draft: EntityDraft): Promise<void> {
    const productId = str(draft, 'product');
    const locationId = str(draft, 'location');
    if (!productId || !locationId) return;
    const product = this.products.find((p) => p.id === productId);
    await stockStore.setQuantity(productId, locationId, num(draft, 'quantity', 0), { min: product?.minQty, max: product?.maxQty });
  }

  private async createCampaign(draft: EntityDraft): Promise<void> {
    const zoneId = str(draft, 'zoneId');
    await inventoryStore.create({
      id: '',
      name: str(draft, 'name'),
      status: 'counting',
      createdAt: new Date().toISOString(),
      zoneId,
      lines: this.snapshotLines(zoneId)
    });
  }

  /** Snapshot current stock into count lines for a scope (empty zone = whole warehouse). */
  private snapshotLines(zoneId: string): InventoryLine[] {
    const inScope = (locationId: string): boolean => {
      if (!zoneId) return true;
      return this.locations.find((l) => l.id === locationId)?.zoneId === zoneId;
    };
    return this.stock
      .filter((c) => inScope(c.locationId))
      .map((c) => ({ locationId: c.locationId, productId: c.productId, systemQty: c.quantity, countedQty: null }));
  }

  private async removeStock(id: string): Promise<void> {
    await stockStore.remove(id);
    await this.reload();
  }

  private async saveCounts(counts: CountEntry[]): Promise<void> {
    const campaign = this.openCampaign;
    if (!campaign) return;
    const byKey = new Map(counts.map((c) => [`${c.locationId}__${c.productId}`, c.counted]));
    const lines = campaign.lines.map((l) => ({ ...l, countedQty: byKey.get(`${l.locationId}__${l.productId}`) ?? l.countedQty }));
    await inventoryStore.save({ ...campaign, lines });
    await this.reload();
  }

  // --- confirmations -----------------------------------------------------------

  private ask(kind: ConfirmKind, id: string, message: string): void {
    this.confirm = { kind, id, message };
  }

  private async onConfirm(): Promise<void> {
    const c = this.confirm;
    this.confirm = null;
    if (!c) return;
    switch (c.kind) {
      case 'delzone': {
        await this.deleteZone(c.id);
        break;
      }
      case 'delloc': {
        await this.deleteLocation(c.id);
        break;
      }
      case 'delproduct': {
        await this.deleteProduct(c.id);
        break;
      }
      case 'delcampaign': {
        await inventoryStore.remove(c.id);
        break;
      }
      default: {
        await this.validateCampaign(c.id);
      }
    }
    await this.reload();
  }

  private async deleteZone(id: string): Promise<void> {
    const locs = this.locations.filter((l) => l.zoneId === id);
    for (const loc of locs) await this.deleteLocation(loc.id);
    await zoneStore.remove(id);
  }

  private async deleteLocation(id: string): Promise<void> {
    for (const cell of this.stock.filter((c) => c.locationId === id)) await stockStore.remove(cell.id);
    await locationStore.remove(id);
  }

  private async deleteProduct(id: string): Promise<void> {
    for (const cell of this.stock.filter((c) => c.productId === id)) await stockStore.remove(cell.id);
    await productStore.remove(id);
  }

  private async validateCampaign(id: string): Promise<void> {
    const campaign = this.campaigns.find((c) => c.id === id);
    if (!campaign) return;
    for (const line of campaign.lines) {
      if (line.countedQty == null) continue;
      const product = this.products.find((p) => p.id === line.productId);
      await stockStore.setQuantity(line.productId, line.locationId, line.countedQty, { min: product?.minQty, max: product?.maxQty });
    }
    await inventoryStore.save({ ...campaign, status: 'validated', validatedAt: new Date().toISOString() });
  }
}

if (!customElements.get('wui-warehouse')) {
  customElements.define('wui-warehouse', WuiWarehouse);
}
