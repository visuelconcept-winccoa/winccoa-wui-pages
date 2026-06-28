// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Remote VNC — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages a catalogue of remote VNC connections (CRUD, 1 datapoint per
 * connection of type `RemoteVnc_Connection`, with optional stored password and a
 * last-connected timestamp) and opens a session **in the browser** with the
 * bundled noVNC client. noVNC connects over a WebSocket to the same-origin relay
 * `/api/vnc/ws?id=<id>` (served by the customer webserver), which resolves the
 * id → host:port via the `VncProxy` MSA manager and proxies the raw TCP stream.
 *
 * The page is a master/detail: a sortable CRUD table, and the noVNC viewer when
 * a connection is opened. Built as a separate entry point (auto-discovered by
 * build:pages) and loaded at runtime via dynamic import.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { ConnectionStore } from './remote-vnc/data/connection-store.js';
import { DEMO_CONNECTIONS } from './remote-vnc/data/demo-connections.js';
import { exportConnection, exportJson, parseConnections } from './remote-vnc/data/io.js';
import type { VncConnection, VncStatus } from './remote-vnc/types.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './remote-vnc/ui/rv-connection-dialog.js';
import './remote-vnc/ui/rv-connection-table.js';
import './remote-vnc/ui/rv-viewer.js';

const PAD_LEN = 2;
/** How often to refresh the per-connection TCP reachability indicators. */
const STATUS_POLL_MS = 5000;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class WuiRemoteVnc extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/remote-vnc/:connectionid` → open connection id (list when absent). */
  @property({ attribute: 'connectionid' }) connectionId = '';

  @state() private connections: VncConnection[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Editor target: an existing connection, `null` for "new", or undefined = closed. */
  @state() private editing: VncConnection | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';
  /** Live TCP reachability per connection id (polled from /api/vnc/status). */
  @state() private statusById: Record<string, VncStatus> = {};

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new ConnectionStore();
  private statusTimer = 0;

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Remote VNC',
                fr: 'Connexions VNC distantes',
                'de_AT.utf8': 'Remote-VNC'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.importError
            ? html`<div class="notice error"><ix-icon name="warning"></ix-icon>${this.importError}</div>`
            : nothing}
          ${this.offline
            ? html`<div class="notice">
                <ix-icon name="info"></ix-icon>Mode hors-ligne : modifications non persistées dans les
                datapoints (backend indisponible ou droits d'écriture manquants).
              </div>`
            : nothing}
          ${this.renderBody()}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<rv-connection-dialog
            .connection=${this.editing}
            @wui:save=${this.onSave}
            @wui:cancel=${this.closeDialog}
          ></rv-connection-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${`Supprimer la connexion « ${this.connName(this.deletingId)} » ?`}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.refreshStatus();
    this.statusTimer = window.setInterval(() => void this.refreshStatus(), STATUS_POLL_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.statusTimer) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = 0;
    }
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderBody(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedConnection();
    if (selected) {
      return html`<rv-viewer
        .connection=${selected}
        @wui:back=${this.goToList}
      ></rv-viewer>`;
    }
    return html`
      <div class="toolbar">
        <span class="count">${this.connections.length} connexion(s)</span>
        <span class="grow"></span>
        <ix-button variant="secondary" @click=${this.triggerImport}>
          <ix-icon name="upload" slot="icon"></ix-icon>Importer
        </ix-button>
        <ix-button
          variant="secondary"
          ?disabled=${this.connections.length === 0}
          @click=${this.onExportAll}
        >
          <ix-icon name="download" slot="icon"></ix-icon>Exporter tout
        </ix-button>
        <ix-button @click=${this.openCreate}>
          <ix-icon name="plus" slot="icon"></ix-icon>Nouvelle connexion
        </ix-button>
      </div>
      <input
        class="import-input"
        type="file"
        accept="application/json,.json"
        hidden
        @change=${this.onImportFile}
      />
      ${this.renderList()}
    `;
  }

  private renderList(): TemplateResult {
    if (this.connections.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>Aucune connexion VNC enregistrée.</ix-typography>
          <ix-button variant="secondary" @click=${this.generateDemo}>
            <ix-icon name="add" slot="icon"></ix-icon>Générer des connexions de démonstration
          </ix-button>
        </div>
      `;
    }
    return html`
      <rv-connection-table
        .connections=${this.connections}
        .statusById=${this.statusById}
        @wui:open=${(e: CustomEvent<{ id: string }>) => this.onOpen(e.detail.id)}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
        @wui:export=${(e: CustomEvent<{ id: string }>) => this.onExportOne(e.detail.id)}
        @wui:fav=${(e: CustomEvent<{ id: string }>) => this.onToggleFav(e.detail.id)}
      ></rv-connection-table>
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.connections = await this.store.listConnections();
    this.offline = this.store.offline;
    this.loading = false;
    // Deep-link: arriving directly on /remote-vnc/<id> records the connection.
    if (this.connectionId) void this.stamp(this.connectionId);
  }

  /** Poll the cyclic server-side TCP reachability test (independent of sessions). */
  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/vnc/status');
      if (!res.ok) return;
      this.statusById = (await res.json()) as Record<string, VncStatus>;
    } catch {
      // Endpoint unavailable — leave reachability indicators as-is.
    }
  }

  private selectedConnection(): VncConnection | undefined {
    return this.connectionId ? this.connections.find((c) => c.id === this.connectionId) : undefined;
  }

  /** Open a connection → navigate to its own route `/remote-vnc/<id>`. */
  private onOpen(id: string): void {
    this.navigate(id);
    void this.stamp(id);
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/remote-vnc/${id}`));
  }

  private goToList(): void {
    this.dispatchEvent(new RouterEvent('/remote-vnc'));
  }

  /** Record the last-connected timestamp on a connection (best-effort). */
  private async stamp(id: string): Promise<void> {
    const conn = this.connections.find((c) => c.id === id);
    if (!conn) return;
    const stamped: VncConnection = { ...conn, lastConnectedAt: nowLocal() };
    this.connections = this.connections.map((c) => (c.id === id ? stamped : c));
    await this.store.saveConnection(stamped);
    this.offline = this.store.offline;
  }

  private openCreate(): void {
    this.editing = null;
  }

  private openEdit(id: string): void {
    this.editing = this.connections.find((c) => c.id === id) ?? null;
  }

  private closeDialog(): void {
    this.editing = undefined;
  }

  private async onSave(event: CustomEvent<VncConnection>): Promise<void> {
    const conn = event.detail;
    if (this.editing) {
      await this.store.saveConnection(conn);
      this.connections = this.connections.map((c) => (c.id === conn.id ? conn : c));
    } else {
      const created = await this.store.createConnection(conn);
      this.connections = [...this.connections, created];
    }
    this.editing = undefined;
    this.offline = this.store.offline;
  }

  private async onToggleFav(id: string): Promise<void> {
    const conn = this.connections.find((c) => c.id === id);
    if (!conn) return;
    const next: VncConnection = { ...conn, favorite: !conn.favorite };
    this.connections = this.connections.map((c) => (c.id === id ? next : c));
    await this.store.saveConnection(next);
    this.offline = this.store.offline;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.deleteConnection(id);
    this.connections = this.connections.filter((c) => c.id !== id);
    this.deletingId = null;
    this.offline = this.store.offline;
    if (this.connectionId === id) this.goToList();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    const created = await this.store.importDemo(DEMO_CONNECTIONS);
    this.connections = this.offline ? await this.store.listConnections() : [...this.connections, ...created];
    this.offline = this.store.offline;
    this.loading = false;
  }

  // --- import / export -------------------------------------------------------

  private onExportAll(): void {
    exportJson(this.connections);
  }

  private onExportOne(id: string): void {
    const conn = this.connections.find((c) => c.id === id);
    if (conn) exportConnection(conn);
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
    let parsed: VncConnection[];
    try {
      parsed = parseConnections(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Import échoué.';
      return;
    }
    this.importError = '';
    const byId = new Map(this.connections.map((c) => [c.id, c]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        await this.store.saveConnection(incoming);
        byId.set(incoming.id, incoming);
      } else {
        const created = await this.store.createConnection(incoming);
        byId.set(created.id, created);
      }
    }
    this.connections = [...byId.values()];
    this.offline = this.store.offline;
  }

  private connName(id: string): string {
    const conn = this.connections.find((c) => c.id === id);
    return conn ? conn.name || conn.host : id;
  }
}

if (!customElements.get('wui-remote-vnc')) {
  customElements.define('wui-remote-vnc', WuiRemoteVnc);
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
      gap: 0.75rem;
      padding: 0.5rem 0;
    }
    .toolbar .grow {
      flex: 1;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    rv-connection-table {
      flex: 1;
      min-height: 0;
    }
    rv-viewer {
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
