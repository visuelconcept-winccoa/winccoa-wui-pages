// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Camera Streams (RTSP) — Standalone page (WinCC OA WebUI Runtime).
 *
 * Manages a catalogue of RTSP IP cameras (CRUD, 1 datapoint per camera of type
 * `RtspCamera_Stream`, with the usual stream options and optional stored
 * credentials) and views a stream **in the browser** with the bundled JSMpeg
 * player. JSMpeg connects over a WebSocket to the dedicated `rtspProxy`
 * JavaScript manager (`ws://<host>:<port>/api/rtsp/stream/<id>`), which resolves
 * the id → rtsp URL server-side, pulls the stream once with ffmpeg, transcodes
 * it to MPEG1-TS and fans it out to every connected client (one RTSP connection
 * shared across all WebUI clients).
 *
 * The page is a master/detail: a sortable CRUD table, and the JSMpeg viewer when
 * a camera is opened. Built as a separate entry point (auto-discovered by
 * build:pages) and loaded at runtime via dynamic import.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { StreamStore } from './camera-streams/data/stream-store.js';
import { DEMO_STREAMS } from './camera-streams/data/demo-streams.js';
import { exportJson, exportStream, parseStreams } from './camera-streams/data/io.js';
import type { CameraStatus, CameraStream } from './camera-streams/types.js';
import { MSG, cameraCountMsg, confirmDeleteCameraMsg, localize, localizeDir } from './camera-streams/i18n.js';
import {
  AuditTrailWriter,
  auditDiff,
  auditSnapshot,
  type AuditRecord
} from '@visuelconcept/wui-kit/data/audit-trail.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './camera-streams/ui/cs-stream-dialog.js';
import './camera-streams/ui/cs-stream-table.js';
import './camera-streams/ui/cs-viewer.js';

const PAD_LEN = 2;
/** How often to refresh the per-camera connected-client counts. */
const CLIENTS_POLL_MS = 4000;

/** Application-Security module id (the specs/menuconfig page id). */
const MODULE_ID = 'camera-streams';

/** Dedicated `_AuditTrail` datapoint that traces every camera edit (GxP). */
const AUDIT_DP = 'AuditTrail_CameraStreams';
/** Camera fields traced in the audit trail (old → new); volatile id/dp/lastViewedAt excluded. */
const AUDITED_FIELDS = [
  'name',
  'group',
  'description',
  'url',
  'username',
  'password',
  'transport',
  'audio',
  'maxWidth',
  'frameRate',
  'videoBitrate',
  'autoReconnect',
  'reconnectDelaySec',
  'favorite'
] as const satisfies readonly (keyof CameraStream)[];
/** Fields masked in the audit trail — secrets are never written to the log in clear text. */
const REDACTED_FIELDS = ['password'] as const satisfies readonly (keyof CameraStream)[];

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class WuiCameraStreams extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/camera-streams/:streamid` → open camera id (list when absent). */
  @property({ attribute: 'streamid' }) streamId = '';

  @state() private streams: CameraStream[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Editor target: an existing camera, `null` for "new", or undefined = closed. */
  @state() private editing: CameraStream | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';
  /** Live connected-client count per camera id (polled from /api/rtsp/clients). */
  @state() private clientsById: Record<string, number> = {};
  /** Live RTSP reachability per camera id (polled from /api/rtsp/status). */
  @state() private statusById: Record<string, CameraStatus> = {};

  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private canView = true;
  /** Application-Security grant for the 'edit' role (open until assigned). */
  @state() private canEdit = true;

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new StreamStore();
  /** Traces every camera edit into a dedicated `_AuditTrail` DP (auto-provisioned). */
  private readonly audit = new AuditTrailWriter({ dpName: AUDIT_DP, itemType: 'RtspCamera' });
  private clientsTimer = 0;
  private roleSubs = new Subscription();

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Camera Streams (RTSP)',
                fr: 'Flux caméras (RTSP)',
                'de_AT.utf8': 'Kamera-Streams (RTSP)'
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
                <ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}
              </div>`
            : nothing}
          ${this.renderBody()}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<cs-stream-dialog
            .stream=${this.editing}
            @wui:save=${this.onSave}
            @wui:cancel=${this.closeDialog}
          ></cs-stream-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteCameraMsg(this.camName(this.deletingId))}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSubs = new Subscription();
    this.roleSubs.add(hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.canView = granted)));
    this.roleSubs.add(
      hasRole$(MODULE_ID, 'edit').subscribe((granted) => {
        this.canEdit = granted;
        if (!granted) {
          // Drop out of any live edit session: close the editor / delete confirm.
          this.editing = undefined;
          this.deletingId = null;
        }
      })
    );
    void this.refreshLive();
    this.clientsTimer = window.setInterval(() => void this.refreshLive(), CLIENTS_POLL_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSubs.unsubscribe();
    if (this.clientsTimer) {
      window.clearInterval(this.clientsTimer);
      this.clientsTimer = 0;
    }
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderBody(): TemplateResult {
    if (!this.canView) {
      return html`<div class="center empty">
        <ix-typography>${localizeDir(MSG.page.roleForbidden)}</ix-typography>
      </div>`;
    }
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedStream();
    if (selected) {
      return html`<cs-viewer .stream=${selected} @wui:back=${this.goToList}></cs-viewer>`;
    }
    return html`
      <div class="toolbar">
        <span class="count">${cameraCountMsg(this.streams.length)}</span>
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" @click=${this.triggerImport}>
              <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.page.import)}
            </ix-button>`
          : nothing}
        <ix-button variant="secondary" ?disabled=${this.streams.length === 0} @click=${this.onExportAll}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.page.exportAll)}
        </ix-button>
        ${this.canEdit
          ? html`<ix-button @click=${this.openCreate}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.page.newCamera)}
            </ix-button>`
          : nothing}
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
    if (this.streams.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>${localizeDir(MSG.page.empty)}</ix-typography>
          ${this.canEdit
            ? html`<ix-button variant="secondary" @click=${this.generateDemo}>
                <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.page.generateDemo)}
              </ix-button>`
            : nothing}
        </div>
      `;
    }
    return html`
      <cs-stream-table
        .streams=${this.streams}
        .clientsById=${this.clientsById}
        .statusById=${this.statusById}
        @wui:open=${(e: CustomEvent<{ id: string }>) => this.onOpen(e.detail.id)}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
        @wui:export=${(e: CustomEvent<{ id: string }>) => this.onExportOne(e.detail.id)}
        @wui:fav=${(e: CustomEvent<{ id: string }>) => this.onToggleFav(e.detail.id)}
      ></cs-stream-table>
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.streams = await this.store.listStreams();
    this.offline = this.store.offline;
    this.loading = false;
    // Provision the audit-trail DP early (best-effort), but only with a real backend.
    if (!this.offline) void this.audit.ensure();
    // Deep-link: arriving directly on /camera-streams/<id> records the view.
    if (this.streamId) void this.stamp(this.streamId);
  }

  /**
   * Trace one camera edit into the audit trail (best-effort, fire-and-forget).
   * No-ops in offline mode (in-memory demo) where nothing is persisted anyway.
   */
  private trace(record: AuditRecord): void {
    if (this.offline) return;
    void this.audit.write(record);
  }

  /** Backing datapoint of a camera — the DPE impacted by the edit (audit "Élément"). */
  private dpeOf(cam: CameraStream): string {
    return cam.dp ?? `RtspCamera_${cam.id}`;
  }

  /** Poll the same-origin proxy for live client counts + RTSP reachability. */
  private async refreshLive(): Promise<void> {
    await Promise.all([this.refreshClients(), this.refreshStatus()]);
  }

  /** Poll the same-origin proxy for the live connected-client count per camera. */
  private async refreshClients(): Promise<void> {
    try {
      const res = await fetch('/api/rtsp/clients');
      if (!res.ok) return;
      this.clientsById = (await res.json()) as Record<string, number>;
    } catch {
      // Endpoint unavailable (offline / webserver bridge down) — leave counts as-is.
    }
  }

  /** Poll the cyclic server-side RTSP reachability probe (independent of clients). */
  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch('/api/rtsp/status');
      if (!res.ok) return;
      this.statusById = (await res.json()) as Record<string, CameraStatus>;
    } catch {
      // Endpoint unavailable — leave reachability indicators as-is.
    }
  }

  private selectedStream(): CameraStream | undefined {
    return this.streamId ? this.streams.find((c) => c.id === this.streamId) : undefined;
  }

  /** Open a camera → navigate to its own route `/camera-streams/<id>`. */
  private onOpen(id: string): void {
    this.navigate(id);
    void this.stamp(id);
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/camera-streams/${id}`));
  }

  private goToList(): void {
    this.dispatchEvent(new RouterEvent('/camera-streams'));
  }

  /** Record the last-viewed timestamp on a camera (best-effort). */
  private async stamp(id: string): Promise<void> {
    const cam = this.streams.find((c) => c.id === id);
    if (!cam) return;
    const stamped: CameraStream = { ...cam, lastViewedAt: nowLocal() };
    this.streams = this.streams.map((c) => (c.id === id ? stamped : c));
    await this.store.saveStream(stamped);
    this.offline = this.store.offline;
  }

  private openCreate(): void {
    this.editing = null;
  }

  private openEdit(id: string): void {
    this.editing = this.streams.find((c) => c.id === id) ?? null;
  }

  private closeDialog(): void {
    this.editing = undefined;
  }

  private async onSave(event: CustomEvent<CameraStream>): Promise<void> {
    const cam = event.detail;
    const before = this.editing;
    if (before) {
      await this.store.saveStream(cam);
      this.streams = this.streams.map((c) => (c.id === cam.id ? cam : c));
      this.offline = this.store.offline;
      const diff = auditDiff(before, cam, AUDITED_FIELDS, { redact: REDACTED_FIELDS });
      if (diff) this.trace({ action: 'UPDATE', item: this.dpeOf(before), oldval: diff.old, newval: diff.new });
    } else {
      const created = await this.store.createStream(cam);
      this.streams = [...this.streams, created];
      this.offline = this.store.offline;
      this.trace({
        action: 'CREATE',
        item: this.dpeOf(created),
        newval: auditSnapshot(created, AUDITED_FIELDS, { redact: REDACTED_FIELDS })
      });
    }
    this.editing = undefined;
  }

  private async onToggleFav(id: string): Promise<void> {
    const cam = this.streams.find((c) => c.id === id);
    if (!cam) return;
    const next: CameraStream = { ...cam, favorite: !cam.favorite };
    this.streams = this.streams.map((c) => (c.id === id ? next : c));
    await this.store.saveStream(next);
    this.offline = this.store.offline;
    this.trace({
      action: 'UPDATE',
      item: this.dpeOf(next),
      reason: 'Bascule favori',
      oldval: `favorite=${cam.favorite}`,
      newval: `favorite=${next.favorite}`
    });
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    const removed = this.streams.find((c) => c.id === id);
    await this.store.deleteStream(id);
    this.streams = this.streams.filter((c) => c.id !== id);
    this.deletingId = null;
    this.offline = this.store.offline;
    if (removed) {
      this.trace({
        action: 'DELETE',
        item: this.dpeOf(removed),
        oldval: auditSnapshot(removed, AUDITED_FIELDS, { redact: REDACTED_FIELDS })
      });
    }
    if (this.streamId === id) this.goToList();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    const created = await this.store.importDemo(DEMO_STREAMS);
    this.streams = this.offline ? await this.store.listStreams() : [...this.streams, ...created];
    this.offline = this.store.offline;
    this.loading = false;
    for (const cam of created) {
      this.trace({
        action: 'CREATE',
        item: this.dpeOf(cam),
        reason: 'Génération démo',
        newval: auditSnapshot(cam, AUDITED_FIELDS, { redact: REDACTED_FIELDS })
      });
    }
  }

  // --- import / export -------------------------------------------------------

  private onExportAll(): void {
    exportJson(this.streams);
  }

  private onExportOne(id: string): void {
    const cam = this.streams.find((c) => c.id === id);
    if (cam) exportStream(cam);
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
    let parsed: CameraStream[];
    try {
      parsed = parseStreams(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.page.importFailed);
      return;
    }
    this.importError = '';
    const byId = new Map(this.streams.map((c) => [c.id, c]));
    for (const incoming of parsed) {
      const previous = incoming.id ? byId.get(incoming.id) : undefined;
      if (previous) {
        await this.store.saveStream(incoming);
        byId.set(incoming.id, incoming);
        this.offline = this.store.offline;
        const diff = auditDiff(previous, incoming, AUDITED_FIELDS, { redact: REDACTED_FIELDS });
        this.trace({
          action: 'IMPORT',
          item: this.dpeOf(previous),
          reason: 'Import fichier',
          oldval: diff?.old,
          newval: diff?.new ?? auditSnapshot(incoming, AUDITED_FIELDS, { redact: REDACTED_FIELDS })
        });
      } else {
        const created = await this.store.createStream(incoming);
        byId.set(created.id, created);
        this.offline = this.store.offline;
        this.trace({
          action: 'IMPORT',
          item: this.dpeOf(created),
          reason: 'Import fichier',
          newval: auditSnapshot(created, AUDITED_FIELDS, { redact: REDACTED_FIELDS })
        });
      }
    }
    this.streams = [...byId.values()];
    this.offline = this.store.offline;
  }

  private camName(id: string): string {
    const cam = this.streams.find((c) => c.id === id);
    return cam ? cam.name : id;
  }
}

if (!customElements.get('wui-camera-streams')) {
  customElements.define('wui-camera-streams', WuiCameraStreams);
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
    cs-stream-table {
      flex: 1;
      min-height: 0;
    }
    cs-viewer {
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
