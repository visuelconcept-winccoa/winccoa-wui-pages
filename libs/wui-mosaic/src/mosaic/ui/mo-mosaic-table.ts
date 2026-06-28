// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table of mosaics shown on the overview. Each row opens the mosaic (display
 * mode), or renames / deletes it.
 *
 * Emits: `wui:open` / `wui:edit` / `wui:export` / `wui:delete` (all `{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tileKindLabel, type Mosaic } from '../types.js';

const PAD_LEN = 2;
const PREVIEW_KINDS = 3;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

@customElement('mo-mosaic-table')
export class MoMosaicTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) mosaics: Mosaic[] = [];

  override render(): TemplateResult {
    const rows = [...this.mosaics].sort((a, b) => a.name.localeCompare(b.name));
    return html`
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th>Sources</th>
            <th class="num">Tuiles</th>
            <th>Dernière modification</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((mosaic) => this.renderRow(mosaic))}
        </tbody>
      </table>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- single table-row template
  private renderRow(mosaic: Mosaic): TemplateResult {
    return html`
      <tr class="clickable" @click=${() => this.requestOpen(mosaic.id)}>
        <td>
          <div class="strong">${mosaic.name || '—'}</div>
          <div class="muted">${mosaic.description}</div>
        </td>
        <td>${this.renderKinds(mosaic)}</td>
        <td class="num">${mosaic.tiles.length}</td>
        <td class="mono">${this.fmtDate(mosaic.updatedAt)}</td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button
            ghost
            size="16"
            icon="screen"
            title="Ouvrir"
            @click=${() => this.requestOpen(mosaic.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="pen"
            title="Renommer"
            @click=${() => this.requestEdit(mosaic.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="download"
            title="Exporter cette mosaïque"
            @click=${() => this.requestExport(mosaic.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title="Supprimer"
            @click=${() => this.requestDelete(mosaic.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private renderKinds(mosaic: Mosaic): TemplateResult {
    const labels = mosaic.tiles.slice(0, PREVIEW_KINDS).map((t) => tileKindLabel(t.kind));
    const extra = mosaic.tiles.length - labels.length;
    if (labels.length === 0) return html`<span class="muted">vide</span>`;
    return html`
      ${labels.map((l) => html`<span class="chip">${l}</span>`)}
      ${extra > 0 ? html`<span class="chip">+${extra}</span>` : null}
    `;
  }

  private fmtDate(value: string): string {
    if (!value) return 'jamais';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private requestOpen(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:open', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestExport(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:export', { detail: { id }, bubbles: true, composed: true }));
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
    th.num,
    td.num {
      text-align: right;
      width: 1%;
      white-space: nowrap;
    }
    tbody td {
      padding: 0.45rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tr.clickable {
      cursor: pointer;
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
      font-size: 0.74rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
      margin: 0 0.2rem 0.2rem 0;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
  `;
}
