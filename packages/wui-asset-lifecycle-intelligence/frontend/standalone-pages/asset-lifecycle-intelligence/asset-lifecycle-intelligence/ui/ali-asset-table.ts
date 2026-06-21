/**
 * Sortable table of managed assets. Each row shows identity columns plus the
 * computed risk score (coloured badge) and the recommended action. Rows are
 * sorted by risk score descending by default. Emits `wui:edit` / `wui:delete`
 * with the asset id.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { bandForLevel, computeRisk, type RiskResult } from '../risk.js';
import { PHASE_LABELS, SOURCE_COLORS, SOURCE_LABELS, type Asset } from '../types.js';

type SortKey = 'name' | 'area' | 'phase' | 'score';

interface Row {
  asset: Asset;
  risk: RiskResult;
}

@customElement('ali-asset-table')
export class AliAssetTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) assets: Asset[] = [];

  @state() private sortKey: SortKey = 'score';
  @state() private sortAsc = false;

  override render(): TemplateResult {
    const rows = this.sortedRows();
    return html`
      <table>
        <thead>
          <tr>
            ${this.header('Désignation', 'name')}
            <th>MLFB</th>
            <th>Station</th>
            ${this.header('Atelier', 'area')}
            <th>Source</th>
            ${this.header('Phase', 'phase')}
            ${this.header('Score', 'score')}
            <th>Niveau</th>
            <th>Action recommandée</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => this.renderRow(row))}
        </tbody>
      </table>
    `;
  }

  private renderRow(row: Row): TemplateResult {
    const band = bandForLevel(row.risk.level);
    const { asset } = row;
    return html`
      <tr>
        <td class="strong">${asset.name}</td>
        <td class="mono">${asset.mlfb}</td>
        <td class="mono">${asset.station}</td>
        <td>${asset.area}</td>
        <td>
          <span class="src" style="--c:${SOURCE_COLORS[asset.source]}" title=${asset.tiaProject || SOURCE_LABELS[asset.source]}>
            ${SOURCE_LABELS[asset.source]}
          </span>
        </td>
        <td title=${PHASE_LABELS[asset.phase]}>${asset.phase}</td>
        <td>
          <span class="score" style="--c:${band.color}">${row.risk.score}</span>
        </td>
        <td><span class="level" style="--c:${band.color}">${band.label}</span></td>
        <td class="action">${band.action}</td>
        <td class="actions-col">
          <ix-icon-button
            ghost
            size="16"
            icon="pen"
            title="Modifier"
            @click=${() => this.requestEdit(asset.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title="Supprimer"
            @click=${() => this.requestDelete(asset.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private header(label: string, key: SortKey): TemplateResult {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortAsc ? '▲' : '▼') : '';
    return html`
      <th class="sortable" @click=${() => this.setSort(key)}>${label} <span class="arrow">${arrow}</span></th>
    `;
  }

  private sortedRows(): Row[] {
    const rows: Row[] = this.assets.map((asset) => ({ asset, risk: computeRisk(asset) }));
    const dir = this.sortAsc ? 1 : -1;
    rows.sort((a, b) => dir * this.compare(a, b));
    return rows;
  }

  private compare(a: Row, b: Row): number {
    switch (this.sortKey) {
      case 'score': {
        return a.risk.score - b.risk.score;
      }
      case 'name': {
        return a.asset.name.localeCompare(b.asset.name);
      }
      case 'area': {
        return a.asset.area.localeCompare(b.asset.area);
      }
      case 'phase': {
        return a.asset.phase.localeCompare(b.asset.phase);
      }
      default: {
        return 0;
      }
    }
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = key === 'score' ? false : true;
    }
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestDelete(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true }));
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
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .action {
      color: var(--theme-color-soft-text);
    }
    .src {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--c);
      border: 1px solid var(--c);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .score {
      display: inline-block;
      min-width: 2.2rem;
      text-align: center;
      font-weight: 700;
      color: #fff;
      background: var(--c);
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
    }
    .level {
      color: var(--c);
      font-weight: 600;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
    }
  `;
}
