// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Table of networks shown on the overview. Each row opens the network, or
 * renames / exports / deletes it.
 *
 * Emits: `wui:open` / `wui:edit` / `wui:export` / `wui:delete` (all `{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { Network } from '../types.js';

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

@customElement('am-network-table')
export class AmNetworkTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) networks: Network[] = [];

  override render(): TemplateResult {
    // Group by category (uncategorized last), then by name.
    const rows = [...this.networks].sort(
      (a, b) =>
        (a.category || '￿').localeCompare(b.category || '￿') || a.name.localeCompare(b.name)
    );
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.table.name)}</th>
            <th class="num">${localizeDir(MSG.table.symbols)}</th>
            <th class="num">${localizeDir(MSG.table.wires)}</th>
            <th>${localizeDir(MSG.table.updatedAt)}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((network) => this.renderRow(network))}
        </tbody>
      </table>
    `;
  }

  private renderRow(network: Network): TemplateResult {
    return html`
      <tr class="clickable" @click=${() => this.emit('wui:open', network.id)}>
        <td>
          <div class="strong">
            ${network.name || '—'}
            ${network.category ? html`<span class="chip">${network.category}</span>` : ''}
          </div>
          <div class="muted">${network.description}</div>
        </td>
        <td class="num">${network.nodes.length}</td>
        <td class="num">${network.edges.length}</td>
        <td class="mono">${this.fmtDate(network.updatedAt)}</td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button ghost size="16" icon="screen" title=${localize(MSG.table.open)} @click=${() => this.emit('wui:open', network.id)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.table.rename)} @click=${() => this.emit('wui:edit', network.id)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="download" title=${localize(MSG.table.exportOne)} @click=${() => this.emit('wui:export', network.id)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.table.remove)} @click=${() => this.emit('wui:delete', network.id)}></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private fmtDate(value: string): string {
    if (!value) return localize(MSG.table.never);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private emit(type: string, id: string): void {
    // eslint-disable-next-line no-restricted-syntax -- `type` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(type, { detail: { id }, bubbles: true, composed: true }));
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
    .chip {
      display: inline-block;
      vertical-align: middle;
      margin-left: 0.4rem;
      white-space: nowrap;
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      padding: 0 0.45rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
  `;
}
