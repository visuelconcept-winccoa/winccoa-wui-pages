// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product catalog: a searchable table of SKUs with their thresholds and current
 * warehouse-wide stock. Presentational — emits `wui:add`, `wui:edit {id}` and
 * `wui:remove {id}`; the page opens the dialog and persists. `canEdit` gates the
 * write affordances.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { productUnits } from '../model.js';
import type { Product, StockCell } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('wh-products')
export class WhProducts extends LitElement {
  static override readonly styles = [IXCoreStyles, productsStyles()];

  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: Boolean }) canEdit = false;

  @state() private query = '';

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <ix-input
          class="search"
          placeholder=${localize(MSG.common.search)}
          .value=${this.query}
          @valueChange=${(e: IxValueEvent) => (this.query = String(e.detail))}
        ></ix-input>
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" outline @click=${() => this.emit('wui:add')}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.products.addProduct)}
            </ix-button>`
          : nothing}
      </div>
      ${this.renderTable()}
    `;
  }

  private renderTable(): TemplateResult {
    const rows = this.filtered();
    if (rows.length === 0) return html`<div class="empty">${localizeDir(MSG.products.noProducts)}</div>`;
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.products.colRef)}</th>
            <th>${localizeDir(MSG.products.colName)}</th>
            <th>${localizeDir(MSG.products.colCategory)}</th>
            <th>${localizeDir(MSG.products.colUnit)}</th>
            <th class="num">${localizeDir(MSG.products.colMinMax)}</th>
            <th class="num">${localizeDir(MSG.products.colStock)}</th>
            ${this.canEdit ? html`<th class="actions-col"></th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${rows.map((p) => this.renderRow(p))}
        </tbody>
      </table>
    `;
  }

  private renderRow(product: Product): TemplateResult {
    const units = productUnits(this.stock, product.id);
    const low = units < product.minQty;
    return html`
      <tr>
        <td class="mono strong">${product.ref}</td>
        <td>${product.name}</td>
        <td class="muted">${product.category}</td>
        <td class="muted">${product.unit}</td>
        <td class="num muted">${product.minQty} / ${product.maxQty || '—'}</td>
        <td class="num ${low ? 'low' : ''}">${units.toLocaleString()}</td>
        ${this.canEdit
          ? html`<td class="actions-col">
              <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.common.edit)} @click=${() => this.emit('wui:edit', { id: product.id })}></ix-icon-button>
              <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)} @click=${() => this.emit('wui:remove', { id: product.id })}></ix-icon-button>
            </td>`
          : nothing}
      </tr>
    `;
  }

  private filtered(): Product[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.products;
    return this.products.filter((p) => `${p.ref} ${p.name} ${p.category}`.toLowerCase().includes(q));
  }

  private emit(type: 'wui:add' | 'wui:edit' | 'wui:remove', detail: unknown = {}): void {
    // eslint-disable-next-line no-restricted-syntax -- name is statically constrained by the union type above
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function productsStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
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
    .search {
      min-width: 14rem;
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
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
    }
    .low {
      color: var(--theme-color-warning, #f59e0b);
      font-weight: 600;
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
