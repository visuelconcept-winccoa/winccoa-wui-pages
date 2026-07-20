// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stock panel: KPI tiles (stocked SKUs · total units · products below minimum ·
 * empty locations), a zone filter + text search, and the stock table with a
 * status chip per line. Presentational — emits `wui:add` (new stock entry),
 * `wui:edit {productId,locationId,quantity}` and `wui:remove {id}`; the page owns
 * persistence. `canAdjust` gates the write affordances.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { locationUnits, productUnits, stockStatus } from '../model.js';
import type { Product, StockCell, StockStatus, StorageLocation, Zone } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

const CHIP_VARIANT: Record<StockStatus, string> = { ok: 'success', under: 'warning', over: 'alarm', empty: 'neutral' };

@customElement('wh-stock')
export class WhStock extends LitElement {
  static override readonly styles = [IXCoreStyles, stockStyles()];

  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) zones: Zone[] = [];
  @property({ type: Boolean }) canAdjust = false;

  @state() private filterZone = '';
  @state() private query = '';

  override render(): TemplateResult {
    return html`
      ${this.renderKpis()}
      <div class="bar">
        <ix-select
          class="zone-filter"
          .selectedIndices=${[this.zoneIndex()]}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.readZone(e.detail)}
        >
          <ix-select-item value="" label=${localize(MSG.common.all)}></ix-select-item>
          ${this.zones.map((z) => html`<ix-select-item value=${z.id} label=${`${z.code} · ${z.name}`}></ix-select-item>`)}
        </ix-select>
        <ix-input
          class="search"
          placeholder=${localize(MSG.common.search)}
          .value=${this.query}
          @valueChange=${(e: IxValueEvent) => (this.query = String(e.detail))}
        ></ix-input>
        <span class="grow"></span>
        ${this.canAdjust
          ? html`<ix-button variant="secondary" outline @click=${() => this.emit('wui:add')}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stock.addStock)}
            </ix-button>`
          : nothing}
      </div>
      ${this.renderTable()}
    `;
  }

  private renderKpis(): TemplateResult {
    const totalUnits = this.stock.reduce((sum, c) => sum + c.quantity, 0);
    const stocked = this.products.filter((p) => productUnits(this.stock, p.id) > 0).length;
    const under = this.products.filter((p) => productUnits(this.stock, p.id) < p.minQty).length;
    const empty = this.locations.filter((l) => locationUnits(this.stock, l.id) === 0).length;
    return html`
      <div class="kpis">
        ${this.kpi(String(stocked), MSG.stock.kpiSkus, 'neutral')}
        ${this.kpi(totalUnits.toLocaleString(), MSG.stock.kpiUnits, 'neutral')}
        ${this.kpi(String(under), MSG.stock.kpiUnder, under > 0 ? 'warning' : 'ok')}
        ${this.kpi(String(empty), MSG.stock.kpiEmpty, 'neutral')}
      </div>
    `;
  }

  private kpi(value: string, label: typeof MSG.stock.kpiUnits, tone: 'neutral' | 'warning' | 'ok'): TemplateResult {
    return html`<div class="kpi ${tone}">
      <div class="kpi-val">${value}</div>
      <div class="kpi-lbl">${localizeDir(label)}</div>
    </div>`;
  }

  private renderTable(): TemplateResult {
    const rows = this.filtered();
    if (rows.length === 0) return html`<div class="empty">${localizeDir(MSG.stock.empty)}</div>`;
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.stock.colProduct)}</th>
            <th>${localizeDir(MSG.stock.colLocation)}</th>
            <th class="num">${localizeDir(MSG.stock.colQty)}</th>
            <th class="num">${localizeDir(MSG.stock.colMinMax)}</th>
            <th>${localizeDir(MSG.stock.colStatus)}</th>
            ${this.canAdjust ? html`<th class="actions-col"></th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${rows.map((c) => this.renderRow(c))}
        </tbody>
      </table>
    `;
  }

  private renderRow(cell: StockCell): TemplateResult {
    const product = this.products.find((p) => p.id === cell.productId);
    const loc = this.locations.find((l) => l.id === cell.locationId);
    const zone = this.zones.find((z) => z.id === loc?.zoneId);
    const status = stockStatus(cell.quantity, product);
    return html`
      <tr>
        <td>
          <div class="strong">${product?.name ?? cell.productId}</div>
          <div class="muted mono">${product?.ref ?? ''}</div>
        </td>
        <td>
          <div class="strong">${loc?.code ?? cell.locationId}</div>
          <div class="muted" style="color:${zone?.color ?? 'inherit'}">${zone ? `${zone.code} · ${zone.name}` : ''}</div>
        </td>
        <td class="num strong">${cell.quantity.toLocaleString()} <span class="muted">${product?.unit ?? ''}</span></td>
        <td class="num muted">${product ? `${product.minQty} / ${product.maxQty || '—'}` : '—'}</td>
        <td><ix-chip variant=${CHIP_VARIANT[status]} style="--ix-chip-height: 1.25rem;">${localize(this.statusLabel(status))}</ix-chip></td>
        ${this.canAdjust
          ? html`<td class="actions-col">
              <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.common.edit)} @click=${() => this.editCell(cell)}></ix-icon-button>
              <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)} @click=${() => this.emit('wui:remove', { id: cell.id })}></ix-icon-button>
            </td>`
          : nothing}
      </tr>
    `;
  }

  private statusLabel(status: StockStatus): typeof MSG.stock.statusOk {
    if (status === 'under') return MSG.stock.statusUnder;
    if (status === 'over') return MSG.stock.statusOver;
    if (status === 'empty') return MSG.stock.statusEmpty;
    return MSG.stock.statusOk;
  }

  private filtered(): StockCell[] {
    const q = this.query.trim().toLowerCase();
    return this.stock.filter((c) => {
      const loc = this.locations.find((l) => l.id === c.locationId);
      if (this.filterZone && loc?.zoneId !== this.filterZone) return false;
      if (!q) return true;
      const product = this.products.find((p) => p.id === c.productId);
      const hay = `${product?.ref ?? ''} ${product?.name ?? ''} ${loc?.code ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  private zoneIndex(): number {
    const i = this.zones.findIndex((z) => z.id === this.filterZone);
    return i === -1 ? 0 : i + 1;
  }

  private readZone(detail: string | string[]): void {
    this.filterZone = Array.isArray(detail) ? (detail[0] ?? '') : detail;
  }

  private editCell(cell: StockCell): void {
    this.emit('wui:edit', { productId: cell.productId, locationId: cell.locationId, quantity: cell.quantity });
  }

  private emit(type: 'wui:add' | 'wui:edit' | 'wui:remove', detail: unknown = {}): void {
    // eslint-disable-next-line no-restricted-syntax -- name is statically constrained by the union type above
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function stockStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.6rem;
      margin-bottom: 0.75rem;
    }
    .kpi {
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 4px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      padding: 0.6rem 0.75rem;
      background: var(--theme-color-1);
    }
    .kpi.warning {
      border-left-color: var(--theme-color-warning, #f59e0b);
    }
    .kpi.ok {
      border-left-color: var(--theme-color-success, #10b981);
    }
    .kpi-val {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .kpi-lbl {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .bar .grow {
      flex: 1;
    }
    .zone-filter {
      min-width: 12rem;
    }
    .search {
      min-width: 12rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    th.num,
    td.num {
      text-align: right;
    }
    tbody td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
    .empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
  `;
}
