// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sortable table of VNC connections. Shows favourite, name, endpoint
 * (host:port), group, read-only flag and last-connected time. Each row connects
 * (opens the noVNC viewer), edits, or deletes; the star toggles favourite.
 *
 * Emits: `wui:open` / `wui:edit` / `wui:delete` / `wui:export` / `wui:fav` (all `{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { endpoint, type VncConnection, type VncStatus } from '../types.js';

type SortKey = 'name' | 'host' | 'group' | 'lastConnectedAt';

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

@customElement('rv-connection-table')
export class RvConnectionTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) connections: VncConnection[] = [];
  /** Live TCP reachability per connection id (server-side cyclic socket test). */
  @property({ attribute: false }) statusById: Record<string, VncStatus> = {};

  @state() private sortKey: SortKey = 'name';
  @state() private sortAsc = true;

  override render(): TemplateResult {
    const rows = this.sortedConnections();
    return html`
      <table>
        <thead>
          <tr>
            <th class="star-col"></th>
            <th class="led-col" title="Joignabilité du socket configuré (test serveur cyclique)">État</th>
            ${this.header('Nom', 'name')}
            ${this.header('Hôte:port', 'host')}
            ${this.header('Groupe', 'group')}
            <th>Mode</th>
            ${this.header('Dernière connexion', 'lastConnectedAt')}
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((conn) => this.renderRow(conn))}
        </tbody>
      </table>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- single table-row template
  private renderRow(conn: VncConnection): TemplateResult {
    return html`
      <tr class="clickable" @click=${() => this.requestOpen(conn.id)}>
        <td class="star-col" @click=${(e: Event) => e.stopPropagation()}>
          <button
            class="star ${conn.favorite ? 'on' : ''}"
            title=${conn.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            @click=${() => this.requestFav(conn.id)}
          >
            ${conn.favorite ? '★' : '☆'}
          </button>
        </td>
        <td class="led-col">${this.renderStatus(conn.id)}</td>
        <td>
          <div class="strong">${conn.name || '—'}</div>
          <div class="muted">${conn.description}</div>
        </td>
        <td class="mono">${endpoint(conn)}</td>
        <td>${conn.group || '—'}</td>
        <td>
          ${conn.viewOnly
            ? html`<span class="chip">Lecture seule</span>`
            : html`<span class="chip solid">Contrôle</span>`}
        </td>
        <td class="mono">${this.fmtDate(conn.lastConnectedAt)}</td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button
            ghost
            size="16"
            icon="play"
            title="Connecter"
            @click=${() => this.requestOpen(conn.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="pen"
            title="Modifier"
            @click=${() => this.requestEdit(conn.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="download"
            title="Exporter cette connexion"
            @click=${() => this.requestExport(conn.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title="Supprimer"
            @click=${() => this.requestDelete(conn.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private renderStatus(id: string): TemplateResult {
    const st = this.statusById[id];
    if (!st) {
      return html`<span class="led unknown" title="Joignabilité inconnue (test en attente)"></span>`;
    }
    const cls = st.reachable ? 'ok' : 'ko';
    return html`<span class="led ${cls}" title=${this.statusTitle(st)}></span>`;
  }

  private statusTitle(st: VncStatus): string {
    const when = this.fmtCheckedAt(st.checkedAt);
    const parts: string[] = [st.reachable ? 'Socket joignable' : 'Socket injoignable'];
    if (!st.reachable && st.detail) parts.push(st.detail);
    if (when) parts.push(st.reachable ? `vérifié à ${when}` : when);
    return parts.join(' · ');
  }

  private fmtCheckedAt(value: string): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

  private fmtDate(value: string): string {
    if (!value) return 'jamais';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private sortedConnections(): VncConnection[] {
    const rows = [...this.connections];
    const dir = this.sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return dir * this.compare(a, b);
    });
    return rows;
  }

  private compare(a: VncConnection, b: VncConnection): number {
    switch (this.sortKey) {
      case 'name': {
        return a.name.localeCompare(b.name);
      }
      case 'host': {
        return a.host.localeCompare(b.host) || a.port - b.port;
      }
      case 'group': {
        return a.group.localeCompare(b.group);
      }
      case 'lastConnectedAt': {
        return a.lastConnectedAt.localeCompare(b.lastConnectedAt);
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

  private requestOpen(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:open', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestDelete(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestExport(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:export', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestFav(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:fav', { detail: { id }, bubbles: true, composed: true }));
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
    .star-col {
      width: 1.5rem;
      text-align: center;
    }
    .star {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.05rem;
      line-height: 1;
      color: var(--theme-color-soft-text);
      padding: 0;
    }
    .star.on {
      color: #f59e0b;
    }
    .chip {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .chip.solid {
      color: #fff;
      background: var(--theme-color-primary, #0ea5e9);
      border-color: var(--theme-color-primary, #0ea5e9);
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
    .led-col {
      width: 1%;
      text-align: center;
      white-space: nowrap;
    }
    .led {
      display: inline-block;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      vertical-align: middle;
      border: 1px solid rgba(0, 0, 0, 0.25);
    }
    .led.ok {
      background: #10b981;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
    }
    .led.ko {
      background: #ef4444;
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.7);
    }
    .led.unknown {
      background: #94a3b8;
    }
  `;
}
