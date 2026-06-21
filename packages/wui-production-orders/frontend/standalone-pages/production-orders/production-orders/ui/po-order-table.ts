/**
 * Sortable table of production orders. Shows order/product identity, the
 * atelier+machine assignment, the planned schedule, quantity, a progress bar and
 * coloured priority/status chips. Each row offers the status-workflow actions
 * available for its current status plus edit/delete.
 *
 * Emits: `wui:edit` / `wui:delete` (`{ id }`) and `wui:status`
 * (`{ id, target }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_RANK,
  STATUS_COLORS,
  STATUS_LABELS,
  type OrderStatus,
  type ProductionOrder
} from '../types.js';
import { actionsFor } from '../workflow.js';

type SortKey = 'orderNo' | 'machine' | 'plannedStart' | 'priority' | 'status';

const FULL_PCT = 100;
const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

@customElement('po-order-table')
export class PoOrderTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) orders: ProductionOrder[] = [];

  @state() private sortKey: SortKey = 'plannedStart';
  @state() private sortAsc = true;

  override render(): TemplateResult {
    const rows = this.sortedOrders();
    return html`
      <table>
        <thead>
          <tr>
            ${this.header('N° OF', 'orderNo')}
            <th>Produit</th>
            ${this.header('Atelier · Machine', 'machine')}
            ${this.header('Début prévu', 'plannedStart')}
            <th>Fin prévue</th>
            <th>Qté</th>
            <th>Avancement</th>
            ${this.header('Priorité', 'priority')}
            ${this.header('Statut', 'status')}
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((order) => this.renderRow(order))}
        </tbody>
      </table>
    `;
  }

  private renderRow(order: ProductionOrder): TemplateResult {
    return html`
      <tr>
        <td class="mono strong">${order.orderNo}</td>
        <td>
          <div class="strong">${order.product}</div>
          <div class="muted mono">${order.article}</div>
        </td>
        <td>${this.machineLabel(order)}</td>
        <td class="mono">${this.fmtDate(order.plannedStart)}</td>
        <td class="mono">${this.fmtDate(order.plannedEnd)}</td>
        <td class="mono">${order.qtyProduced}/${order.qtyOrdered}</td>
        <td>${this.renderProgress(order)}</td>
        <td>
          <span class="chip" style="--c:${PRIORITY_COLORS[order.priority]}">
            ${PRIORITY_LABELS[order.priority]}
          </span>
        </td>
        <td>
          <span class="chip solid" style="--c:${STATUS_COLORS[order.status]}">
            ${STATUS_LABELS[order.status]}
          </span>
        </td>
        <td class="actions-col">${this.renderActions(order)}</td>
      </tr>
    `;
  }

  private renderActions(order: ProductionOrder): TemplateResult {
    const transitions = actionsFor(order.status);
    return html`
      ${transitions.map(
        (action) => html`
          <ix-icon-button
            ghost
            size="16"
            icon=${action.icon}
            title=${action.label}
            @click=${() => this.requestStatus(order.id, action.target)}
          ></ix-icon-button>
        `
      )}
      <ix-icon-button
        ghost
        size="16"
        icon="pen"
        title="Modifier"
        @click=${() => this.requestEdit(order.id)}
      ></ix-icon-button>
      <ix-icon-button
        ghost
        size="16"
        icon="trashcan"
        title="Supprimer"
        @click=${() => this.requestDelete(order.id)}
      ></ix-icon-button>
    `;
  }

  private renderProgress(order: ProductionOrder): TemplateResult {
    const pct = Math.max(0, Math.min(FULL_PCT, order.progress));
    return html`
      <div class="progress" title="${pct}%">
        <div class="progress-fill" style="width:${pct}%;--c:${STATUS_COLORS[order.status]}"></div>
        <span class="progress-text">${pct}%</span>
      </div>
    `;
  }

  private header(label: string, key: SortKey): TemplateResult {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortAsc ? '▲' : '▼') : '';
    return html`
      <th class="sortable" @click=${() => this.setSort(key)}>
        ${label} <span class="arrow">${arrow}</span>
      </th>
    `;
  }

  private machineLabel(order: ProductionOrder): string {
    if (order.machineName && order.atelierName) return `${order.atelierName} · ${order.machineName}`;
    return order.atelierName || order.machineName || '—';
  }

  private fmtDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private sortedOrders(): ProductionOrder[] {
    const rows = [...this.orders];
    const dir = this.sortAsc ? 1 : -1;
    rows.sort((a, b) => dir * this.compare(a, b));
    return rows;
  }

  private compare(a: ProductionOrder, b: ProductionOrder): number {
    switch (this.sortKey) {
      case 'orderNo': {
        return a.orderNo.localeCompare(b.orderNo);
      }
      case 'machine': {
        return this.machineLabel(a).localeCompare(this.machineLabel(b));
      }
      case 'plannedStart': {
        return a.plannedStart.localeCompare(b.plannedStart);
      }
      case 'priority': {
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
      case 'status': {
        return a.status.localeCompare(b.status);
      }
      default: {
        return 0;
      }
    }
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else {
      this.sortKey = key;
      this.sortAsc = true;
    }
  }

  private requestStatus(id: string, target: OrderStatus): void {
    this.dispatchEvent(
      new CustomEvent('wui:status', { detail: { id, target }, bubbles: true, composed: true })
    );
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestDelete(id: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function tableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
      position: sticky;
      top: 0;
      background: var(--theme-color-1);
      z-index: 1;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    th.sortable:hover {
      color: var(--theme-color-std-text);
    }
    .arrow {
      font-size: 0.7rem;
    }
    tbody td {
      padding: 0.45rem 0.6rem;
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
      font-size: 0.78rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .chip {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--c);
      border: 1px solid var(--c);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .chip.solid {
      color: #fff;
      background: var(--c);
      border-color: var(--c);
    }
    .progress {
      position: relative;
      width: 5.5rem;
      height: 1rem;
      border-radius: 999px;
      background: var(--theme-color-component-1, rgba(127, 127, 127, 0.25));
      overflow: hidden;
    }
    .progress-fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--c);
      opacity: 0.85;
    }
    .progress-text {
      position: relative;
      display: block;
      text-align: center;
      font-size: 0.7rem;
      line-height: 1rem;
      color: var(--theme-color-std-text);
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
  `;
}
