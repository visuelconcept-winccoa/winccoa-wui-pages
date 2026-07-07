// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mosaïque — Standalone page (WinCC OA WebUI Runtime).
 *
 * A configurable **display wall**: each mosaic is a free-layout canvas of tiles,
 * every tile embedding one source in an `<iframe>` — a Machine-Fleet-3D atelier
 * (or the ateliers overview), a Remote-VNC viewer (read-only), an RTSP camera
 * stream (read-only), or a same-origin URL. Internal views embed through the
 * dashboard SPA shell with a hash
 * route (see {@link ./mosaic/types.ts}); the source list to integrate is open-
 * ended (more kinds can be added later).
 *
 * The page is a master/detail shell router (like the Machine-Fleet-3D and
 * Remote-VNC pages): `/mosaic` lists the saved mosaics, `/mosaic/:mosaicid`
 * displays one, with an in-place edit mode to add/move/resize tiles. Each mosaic
 * is one datapoint of type `Mosaic_Board`; the store falls back to an in-memory
 * demo list when the backend is unreachable.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import { MosaicStore } from './mosaic/data/mosaic-store.js';
import { DEMO_MOSAICS } from './mosaic/data/demo-mosaics.js';
import { exportJson, exportMosaic, parseMosaics } from './mosaic/data/io.js';
import { SourceCatalog, type SourceOption } from './mosaic/data/source-catalog.js';
import { GRID_PCT, blankMosaic, blankTile, type Mosaic, type Tile } from './mosaic/types.js';
import {
  MSG,
  confirmDeleteMsg,
  localize,
  localizeDir,
  ml,
  mosaicCountMsg,
  tileCountMsg
} from './mosaic/i18n.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './mosaic/ui/mo-canvas.js';
import './mosaic/ui/mo-mosaic-dialog.js';
import './mosaic/ui/mo-mosaic-table.js';
import './mosaic/ui/mo-tile-dialog.js';

const PAD_LEN = 2;
const ID_RADIX = 36;
const CASCADE_WRAP = 6;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class WuiMosaic extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/mosaic/:mosaicid` → displayed mosaic id (overview when absent). */
  @property({ attribute: 'mosaicid' }) mosaicId = '';

  @state() private mosaics: Mosaic[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private editing = false;
  /** Mosaic-editor target: existing mosaic, `null` = new, undefined = closed. */
  @state() private editingMosaic: Mosaic | null | undefined = undefined;
  /** Tile-editor target: existing tile, `null` = new, undefined = closed. */
  @state() private editingTile: Tile | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private ateliers: SourceOption[] = [];
  @state() private vncConnections: SourceOption[] = [];
  @state() private cameras: SourceOption[] = [];
  @state() private ampereNetworks: SourceOption[] = [];
  @state() private importError = '';

  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private roleView = true;
  /** Application-Security grant for the 'edit' role (open until assigned). */
  @state() private canEdit = true;

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new MosaicStore();
  private readonly catalog = new SourceCatalog();
  private roleSub = new Subscription();

  // eslint-disable-next-line max-lines-per-function -- single page template with dialogs
  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Mosaic', fr: 'Mosaïque', 'de_AT.utf8': 'Mosaik' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          ${this.roleView
            ? html`
                ${this.importError
                  ? html`<div class="notice error"><ix-icon name="warning"></ix-icon>${this.importError}</div>`
                  : nothing}
                ${this.offline
                  ? html`<div class="notice">
                      <ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}
                    </div>`
                  : nothing}
                ${this.renderBody()}
              `
            : this.renderForbidden()}
        </div>
      </div>

      ${this.editingMosaic === undefined
        ? nothing
        : html`<mo-mosaic-dialog
            .mosaic=${this.editingMosaic}
            @wui:save=${this.onMosaicSave}
            @wui:cancel=${() => (this.editingMosaic = undefined)}
          ></mo-mosaic-dialog>`}
      ${this.editingTile === undefined
        ? nothing
        : html`<mo-tile-dialog
            .tile=${this.editingTile}
            .ateliers=${this.ateliers}
            .vncConnections=${this.vncConnections}
            .cameras=${this.cameras}
            .ampereNetworks=${this.ampereNetworks}
            @wui:save=${this.onTileSave}
            @wui:cancel=${() => (this.editingTile = undefined)}
          ></mo-tile-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteMsg(this.mosaicName(this.deletingId))}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles({
      module: 'mosaic',
      title: ml('Mosaic', 'Mosaïque', 'Mosaik'),
      roles: [
        { id: 'view', label: ml('View', 'Consulter', 'Ansehen') },
        {
          id: 'edit',
          label: ml('Edit', 'Éditer', 'Bearbeiten'),
          description: ml('Compose display walls', "Composer les murs d'écrans", 'Bildschirmwände zusammenstellen')
        }
      ]
    });
    this.roleSub = new Subscription();
    this.roleSub.add(
      hasRole$('mosaic', 'view').subscribe((granted) => {
        this.roleView = granted;
        if (!granted) this.dropEditingSession();
      })
    );
    this.roleSub.add(
      hasRole$('mosaic', 'edit').subscribe((granted) => {
        this.canEdit = granted;
        if (!granted) this.dropEditingSession();
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
    void this.loadCatalog();
  }

  protected override willUpdate(changed: PropertyValues): void {
    // Leaving the display route drops edit mode.
    if (changed.has('mosaicId') && !this.mosaicId) this.editing = false;
  }

  private renderBody(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedMosaic();
    if (this.mosaicId && selected) return this.renderDisplay(selected);
    if (this.mosaicId && !selected) return this.renderMissing();
    return this.renderOverview();
  }

  // --- overview --------------------------------------------------------------

  private renderOverview(): TemplateResult {
    return html`
      <div class="toolbar">
        <span class="count">${mosaicCountMsg(this.mosaics.length)}</span>
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" @click=${this.triggerImport}>
              <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.import)}
            </ix-button>`
          : nothing}
        <ix-button variant="secondary" ?disabled=${this.mosaics.length === 0} @click=${this.onExportAll}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.exportAll)}
        </ix-button>
        ${this.canEdit
          ? html`<ix-button @click=${this.openCreate}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.newMosaic)}
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
      ${this.mosaics.length === 0
        ? html`<div class="center empty">
            <ix-typography>${localizeDir(MSG.page.emptyList)}</ix-typography>
            ${this.canEdit
              ? html`<ix-button variant="secondary" @click=${this.generateDemo}>
                  <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.page.generateDemo)}
                </ix-button>`
              : nothing}
          </div>`
        : html`<mo-mosaic-table
            .mosaics=${this.mosaics}
            @wui:open=${(e: CustomEvent<{ id: string }>) => this.navigate(e.detail.id)}
            @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openRename(e.detail.id)}
            @wui:export=${(e: CustomEvent<{ id: string }>) => this.onExportOne(e.detail.id)}
            @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
          ></mo-mosaic-table>`}
    `;
  }

  private renderMissing(): TemplateResult {
    return html`<div class="center empty">
      <ix-typography>${localizeDir(MSG.page.missing)}</ix-typography>
      <ix-button variant="secondary" @click=${this.goToList}>${localizeDir(MSG.page.backToList)}</ix-button>
    </div>`;
  }

  /** Body shown instead of the mosaics when the 'view' role is not granted. */
  private renderForbidden(): TemplateResult {
    return html`<div class="center empty">
      <ix-typography>${localizeDir(MSG.page.roleForbidden)}</ix-typography>
    </div>`;
  }

  /** Leave edit mode and close every composition dialog (role revoked live). */
  private dropEditingSession(): void {
    this.editing = false;
    this.editingMosaic = undefined;
    this.editingTile = undefined;
    this.deletingId = null;
  }

  // --- display / edit --------------------------------------------------------

  // eslint-disable-next-line max-lines-per-function -- single toolbar + canvas template
  private renderDisplay(mosaic: Mosaic): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.goToList}>${localizeDir(MSG.toolbar.backToList)}</ix-button>
        <span class="title">${mosaic.name}</span>
        <span class="count">${tileCountMsg(mosaic.tiles.length)}</span>
        <span class="grow"></span>
        ${this.editing
          ? html`<ix-button variant="secondary" @click=${() => (this.editingTile = null)}>
                <ix-icon name="add-circle" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.addTile)}
              </ix-button>
              <ix-button @click=${() => (this.editing = false)}>
                <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.done)}
              </ix-button>`
          : (this.canEdit
              ? html`<ix-button variant="secondary" @click=${() => (this.editing = true)}>
                  <ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.edit)}
                </ix-button>`
              : nothing)}
      </div>
      <mo-canvas
        class="canvas"
        .tiles=${mosaic.tiles}
        ?editing=${this.editing}
        @wui:layout=${(e: CustomEvent<{ tiles: Tile[] }>) => this.onLayout(mosaic, e.detail.tiles)}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEditTile(mosaic, e.detail.id)}
        @wui:remove=${(e: CustomEvent<{ id: string }>) => this.onTileRemove(mosaic, e.detail.id)}
      ></mo-canvas>
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.mosaics = await this.store.listMosaics();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async loadCatalog(): Promise<void> {
    const [ateliers, vnc, cameras, ampereNetworks] = await Promise.all([
      this.catalog.listAteliers(),
      this.catalog.listVncConnections(),
      this.catalog.listCameras(),
      this.catalog.listAmpereNetworks()
    ]);
    this.ateliers = ateliers;
    this.vncConnections = vnc;
    this.cameras = cameras;
    this.ampereNetworks = ampereNetworks;
  }

  private selectedMosaic(): Mosaic | undefined {
    return this.mosaicId ? this.mosaics.find((m) => m.id === this.mosaicId) : undefined;
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/mosaic/${id}`));
  }

  private goToList(): void {
    this.dispatchEvent(new RouterEvent('/mosaic'));
  }

  /** Replace a mosaic in the list, stamp it and persist (best-effort). */
  private async persist(mosaic: Mosaic): Promise<void> {
    const stamped: Mosaic = { ...mosaic, updatedAt: nowLocal() };
    this.mosaics = this.mosaics.map((m) => (m.id === stamped.id ? stamped : m));
    await this.store.saveMosaic(stamped);
    this.offline = this.store.offline;
  }

  // --- mosaic CRUD -----------------------------------------------------------

  private openCreate(): void {
    this.editingMosaic = null;
  }

  private openRename(id: string): void {
    this.editingMosaic = this.mosaics.find((m) => m.id === id) ?? null;
  }

  private async onMosaicSave(event: CustomEvent<Mosaic>): Promise<void> {
    const incoming = event.detail;
    if (this.editingMosaic) {
      const updated: Mosaic = { ...this.editingMosaic, name: incoming.name, description: incoming.description };
      this.editingMosaic = undefined;
      await this.persist(updated);
    } else {
      const created = await this.store.createMosaic({ ...blankMosaic(), ...incoming, updatedAt: nowLocal() });
      this.mosaics = [...this.mosaics, created];
      this.offline = this.store.offline;
      this.editingMosaic = undefined;
      this.editing = true;
      this.navigate(created.id);
    }
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.deleteMosaic(id);
    this.mosaics = this.mosaics.filter((m) => m.id !== id);
    this.deletingId = null;
    this.offline = this.store.offline;
    if (this.mosaicId === id) this.goToList();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    const created = await this.store.importDemo(DEMO_MOSAICS);
    this.mosaics = this.offline ? await this.store.listMosaics() : [...this.mosaics, ...created];
    this.offline = this.store.offline;
    this.loading = false;
  }

  // --- import / export -------------------------------------------------------

  private onExportAll(): void {
    exportJson(this.mosaics);
  }

  private onExportOne(id: string): void {
    const mosaic = this.mosaics.find((m) => m.id === id);
    if (mosaic) exportMosaic(mosaic);
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
    let parsed: Mosaic[];
    try {
      parsed = parseMosaics(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.page.importFailed);
      return;
    }
    this.importError = '';
    const byId = new Map(this.mosaics.map((m) => [m.id, m]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        const updated: Mosaic = { ...incoming, updatedAt: nowLocal() };
        await this.store.saveMosaic(updated);
        byId.set(updated.id, updated);
      } else {
        const created = await this.store.createMosaic({ ...incoming, updatedAt: nowLocal() });
        byId.set(created.id, created);
      }
    }
    this.mosaics = [...byId.values()];
    this.offline = this.store.offline;
  }

  // --- tile CRUD -------------------------------------------------------------

  private openEditTile(mosaic: Mosaic, id: string): void {
    this.editingTile = mosaic.tiles.find((t) => t.id === id) ?? null;
  }

  private async onTileSave(event: CustomEvent<Tile>): Promise<void> {
    const mosaic = this.selectedMosaic();
    if (!mosaic) return;
    const incoming = event.detail;
    const editing = this.editingTile;
    this.editingTile = undefined;
    let tiles: Tile[];
    if (editing) {
      tiles = mosaic.tiles.map((t) => (t.id === incoming.id ? { ...incoming, id: t.id } : t));
    } else {
      const offset = (mosaic.tiles.length % CASCADE_WRAP) * GRID_PCT;
      const created: Tile = {
        ...blankTile(),
        ...incoming,
        id: `t-${Date.now().toString(ID_RADIX)}`,
        x: blankTile().x + offset,
        y: blankTile().y + offset
      };
      tiles = [...mosaic.tiles, created];
    }
    await this.persist({ ...mosaic, tiles });
  }

  private async onTileRemove(mosaic: Mosaic, id: string): Promise<void> {
    await this.persist({ ...mosaic, tiles: mosaic.tiles.filter((t) => t.id !== id) });
  }

  private async onLayout(mosaic: Mosaic, tiles: Tile[]): Promise<void> {
    await this.persist({ ...mosaic, tiles });
  }

  private mosaicName(id: string): string {
    return this.mosaics.find((m) => m.id === id)?.name || id;
  }
}

if (!customElements.get('wui-mosaic')) {
  customElements.define('wui-mosaic', WuiMosaic);
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
    .toolbar .title {
      font-weight: 600;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    mo-mosaic-table {
      flex: 1;
      min-height: 0;
    }
    mo-canvas.canvas {
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
