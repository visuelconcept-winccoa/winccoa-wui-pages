/**
 * Sortable table of managed assets. Each row shows identity columns plus the
 * computed risk score (coloured badge) and the recommended action. Rows are
 * sorted by risk score descending by default. Emits `wui:edit` / `wui:delete`
 * with the asset id.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { bandForLevel, computeRisk, type RiskResult } from '../risk.js';
import { deriveSupportUrl } from '../data/product-info.js';
import { PHASE_LABELS, SOURCE_COLORS, SOURCE_LABELS, type Asset, type RiskLevel } from '../types.js';

type SortKey = 'name' | 'mlfb' | 'station' | 'area' | 'assetGroup' | 'source' | 'phase' | 'score' | 'level';

/** Optional (toggleable) columns — name + score + actions are always shown. */
export const TABLE_COLUMNS: { key: string; label: MultiLangString }[] = [
  { key: 'mlfb', label: MSG.table.mlfb },
  { key: 'station', label: MSG.table.station },
  { key: 'area', label: MSG.table.area },
  { key: 'assetGroup', label: MSG.table.assetGroup },
  { key: 'source', label: MSG.table.source },
  { key: 'phase', label: MSG.table.phase },
  { key: 'level', label: MSG.table.level },
  { key: 'action', label: MSG.table.action }
];

const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

interface Row {
  asset: Asset;
  risk: RiskResult;
}

@customElement('ali-asset-table')
export class AliAssetTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) assets: Asset[] = [];
  /** Visible optional-column keys; when undefined, every column is shown. */
  @property({ attribute: false }) visibleColumns?: string[];

  @state() private sortKey: SortKey = 'score';
  @state() private sortAsc = false;

  override render(): TemplateResult {
    const rows = this.sortedRows();
    return html`
      <table>
        <thead>
          <tr>
            ${this.header(MSG.table.name, 'name')}
            ${this.col('mlfb', () => this.header(MSG.table.mlfb, 'mlfb'))}
            ${this.col('station', () => this.header(MSG.table.station, 'station'))}
            ${this.col('area', () => this.header(MSG.table.area, 'area'))}
            ${this.col('assetGroup', () => this.header(MSG.table.assetGroup, 'assetGroup'))}
            ${this.col('source', () => this.header(MSG.table.source, 'source'))}
            ${this.col('phase', () => this.header(MSG.table.phase, 'phase'))}
            ${this.header(MSG.table.score, 'score')}
            ${this.col('level', () => this.header(MSG.table.level, 'level'))}
            ${this.col('action', () => html`<th>${localizeDir(MSG.table.action)}</th>`)}
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => this.renderRow(row))}
        </tbody>
      </table>
    `;
  }

  private show(key: string): boolean {
    return !this.visibleColumns || this.visibleColumns.includes(key);
  }

  private col(key: string, render: () => TemplateResult): TemplateResult | typeof nothing {
    return this.show(key) ? render() : nothing;
  }

  // eslint-disable-next-line max-lines-per-function -- single row template with optional columns
  private renderRow(row: Row): TemplateResult {
    const band = bandForLevel(row.risk.level);
    const { asset } = row;
    const supportUrl = asset.supportUrl || deriveSupportUrl(asset.mlfb);
    return html`
      <tr>
        <td class="strong">${asset.name}</td>
        ${this.col('mlfb', () => html`<td class="mono">${asset.mlfb}</td>`)}
        ${this.col('station', () => html`<td class="mono">${asset.station}</td>`)}
        ${this.col('area', () => html`<td>${asset.area}</td>`)}
        ${this.col('assetGroup', () => html`<td>${asset.assetGroup ?? ''}</td>`)}
        ${this.col(
          'source',
          () => html`<td>
            <span class="src" style="--c:${SOURCE_COLORS[asset.source]}" title=${asset.tiaProject || localize(SOURCE_LABELS[asset.source])}>
              ${localizeDir(SOURCE_LABELS[asset.source])}
            </span>
          </td>`
        )}
        ${this.col('phase', () => html`<td title=${localize(PHASE_LABELS[asset.phase])}>${asset.phase}</td>`)}
        <td>
          <span class="score" style="--c:${band.color}">${row.risk.score}</span>
        </td>
        ${this.col('level', () => html`<td><span class="level" style="--c:${band.color}">${localizeDir(band.label)}</span></td>`)}
        ${this.col('action', () => html`<td class="action">${localizeDir(band.action)}</td>`)}
        <td class="actions-col">
          ${supportUrl
            ? html`<ix-icon-button
                ghost
                size="16"
                icon="export"
                title=${localize(MSG.table.support)}
                @click=${() => this.openSupport(supportUrl)}
              ></ix-icon-button>`
            : nothing}
          <ix-icon-button
            ghost
            size="16"
            icon="pen"
            title=${localize(MSG.table.edit)}
            @click=${() => this.requestEdit(asset.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title=${localize(MSG.table.remove)}
            @click=${() => this.requestDelete(asset.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private header(label: MultiLangString, key: SortKey): TemplateResult {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortAsc ? '▲' : '▼') : '';
    return html`
      <th class="sortable" @click=${() => this.setSort(key)}>
        ${localizeDir(label)} <span class="arrow">${arrow}</span>
      </th>
    `;
  }

  private openSupport(url: string): void {
    window.open(url, '_blank', 'noopener');
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
      case 'level': {
        return LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level];
      }
      case 'name': {
        return a.asset.name.localeCompare(b.asset.name);
      }
      case 'mlfb': {
        return a.asset.mlfb.localeCompare(b.asset.mlfb);
      }
      case 'station': {
        return a.asset.station.localeCompare(b.asset.station);
      }
      case 'area': {
        return a.asset.area.localeCompare(b.asset.area);
      }
      case 'assetGroup': {
        return (a.asset.assetGroup ?? '').localeCompare(b.asset.assetGroup ?? '');
      }
      case 'source': {
        return a.asset.source.localeCompare(b.asset.source);
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
