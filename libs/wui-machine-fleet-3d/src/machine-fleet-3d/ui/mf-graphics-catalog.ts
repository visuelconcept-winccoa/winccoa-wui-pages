// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unified graphics-resource catalog (modal) with two tabs:
 *  - **Objets 3D (GLB)** — `.glb`/`.gltf` models (machine type `glb`).
 *  - **Billboards** — `.svg`/`.png`/… icons (machine type `billboard`).
 *
 * Both kinds are stored the same way: one datapoint per resource holding a
 * `name` + base64 `data` blob, referenced as `dp:<name>`. Import / delete go
 * through the kind-agnostic {@link FleetStore} resource API.
 *
 * Emits `wui:change` when the library changes, `wui:close` on dismiss.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { FleetStore } from '../data/fleet-store.js';
import type { GlbResource, GraphicKind } from '../types.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  MSG,
  fileTooLargeMsg,
  localize,
  localizeDir,
  resourcesCountMsg
} from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

const BYTES_PER_MB = 1_000_000;
const MAX_BYTES = 2 * BYTES_PER_MB;

const KIND_CFG: Record<
  GraphicKind,
  { label: MultiLangString; accept: string; icon: string; strip: RegExp }
> = {
  glb: {
    label: MSG.graphicsCatalog.tabGlb,
    accept: '.glb,.gltf',
    icon: 'box-open',
    strip: /\.(glb|gltf)$/i
  },
  billboard: {
    label: MSG.graphicsCatalog.tabBillboards,
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    icon: 'image',
    strip: /\.(svg|png|jpe?g|webp)$/i
  }
};
const KINDS: GraphicKind[] = ['glb', 'billboard'];

@customElement('mf-graphics-catalog')
export class MfGraphicsCatalog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) store: FleetStore | null = null;
  /** When false, the library is view-only: importing/deleting is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private tab = 0;
  @state() private lists: Record<GraphicKind, GlbResource[]> = { glb: [], billboard: [] };
  /** Resolved preview data URLs for image-able resources, keyed by resource id. */
  @state() private previews: Record<string, string> = {};
  @state() private importName = '';
  @state() private importLibrary = '';
  @state() private pendingData = '';
  @state() private pendingFile = '';
  @state() private error = '';
  @state() private busy = false;

  @query('.res-file') private fileInput?: HTMLInputElement;

  private get kind(): GraphicKind {
    return KINDS[this.tab] ?? 'glb';
  }

  override render(): TemplateResult {
    const cfg = KIND_CFG[this.kind];
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel res" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.graphicsCatalog.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <ix-tabs .selected=${this.tab} @selectedChange=${(e: CustomEvent<number>) => this.onTab(e.detail)}>
            ${KINDS.map((k) => html`<ix-tab-item>${localizeDir(KIND_CFG[k].label)}</ix-tab-item>`)}
          </ix-tabs>
          <div class="panel-body">
            ${this.canEdit ? this.renderImport(cfg) : ''} ${this.renderList(cfg)}
            ${this.error ? html`<div class="err">${this.error}</div>` : ''}
          </div>
          <div class="panel-foot">
            <ix-button @click=${this.close}>${localizeDir(MSG.graphicsCatalog.close)}</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
  }

  private renderImport(cfg: (typeof KIND_CFG)[GraphicKind]): TemplateResult {
    const libs = this.libraries();
    return html`
      <div class="subhead">${localizeDir(MSG.graphicsCatalog.import)}</div>
      <div class="import-row">
        <ix-input
          class="imp-name"
          label=${localize(MSG.graphicsCatalog.name)}
          placeholder=${localize(MSG.graphicsCatalog.resourceNamePlaceholder)}
          .value=${this.importName}
          @valueChange=${(e: IxValueEvent) => (this.importName = String(e.detail))}
        ></ix-input>
        <ix-input
          class="imp-lib"
          label=${localize(MSG.graphicsCatalog.library)}
          list="lib-list"
          placeholder=${localize(MSG.graphicsCatalog.optional)}
          .value=${this.importLibrary}
          @valueChange=${(e: IxValueEvent) => (this.importLibrary = String(e.detail))}
        ></ix-input>
        <datalist id="lib-list">${libs.map((l) => html`<option value=${l}></option>`)}</datalist>
        <ix-button variant="secondary" @click=${this.pick}>
          <ix-icon name="folder" slot="icon"></ix-icon>${this.pendingFile || localizeDir(MSG.graphicsCatalog.chooseFile)}
        </ix-button>
        <ix-button
          ?disabled=${this.busy || this.pendingData === '' || this.importName.trim() === ''}
          @click=${this.doImport}
        >
          <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.graphicsCatalog.import)}
        </ix-button>
      </div>
      <input class="res-file" type="file" accept=${cfg.accept} hidden @change=${this.onFile} />
    `;
  }

  /** Distinct non-empty library names of the active kind's resources. */
  private libraries(): string[] {
    const set = new Set<string>();
    for (const r of this.lists[this.kind]) if (r.library) set.add(r.library);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private renderList(cfg: (typeof KIND_CFG)[GraphicKind]): TemplateResult {
    const list = this.lists[this.kind];
    if (list.length === 0)
      return html`<div class="muted">${localizeDir(MSG.graphicsCatalog.noResource)}</div>`;
    // Group by library; unclassified last.
    const groups = new Map<string, GlbResource[]>();
    for (const r of list) {
      const key = r.library || '';
      (groups.get(key) ?? groups.set(key, []).get(key))!.push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.localeCompare(b);
    });
    return html`
      <div class="subhead">${resourcesCountMsg(list.length)}</div>
      ${keys.map(
        (key) => html`<div class="lib-group">
          <div class="lib-title">${key || localizeDir(MSG.graphicsCatalog.noLibrary)}</div>
          <div class="res-grid">${groups.get(key)?.map((r) => this.renderResource(cfg, r))}</div>
        </div>`
      )}
    `;
  }

  private renderResource(cfg: (typeof KIND_CFG)[GraphicKind], r: GlbResource): TemplateResult {
    const preview = this.previews[r.id];
    return html`
      <div class="res-card">
        <div class="res-thumb">
          ${preview
            ? html`<img src=${preview} alt="" />`
            : html`<ix-icon name=${cfg.icon} size="32"></ix-icon>`}
        </div>
        <span class="res-name" title=${r.name}>${r.name}</span>
        ${this.canEdit
          ? html`<ix-input
                class="res-lib"
                list="lib-list"
                placeholder=${localize(MSG.graphicsCatalog.library)}
                .value=${r.library ?? ''}
                @valueChange=${(e: IxValueEvent) => void this.changeLibrary(r, String(e.detail))}
              ></ix-input>
              <ix-icon-button
                ghost
                size="16"
                icon="trashcan"
                title=${localize(MSG.graphicsCatalog.delete)}
                @click=${() => this.removeResource(r)}
              ></ix-icon-button>`
          : ''}
      </div>
    `;
  }

  private onTab(index: number): void {
    this.tab = index;
    this.resetImport();
    void this.reload();
  }

  private async reload(): Promise<void> {
    if (!this.store) return;
    const kind = this.kind;
    const list = await this.store.listResources(kind);
    this.lists = { ...this.lists, [kind]: list };
    if (kind === 'billboard') void this.loadPreviews(list);
  }

  /** Resolve each billboard's data URL for the thumbnail previews. */
  private async loadPreviews(list: GlbResource[]): Promise<void> {
    const store = this.store;
    if (!store) return;
    for (const r of list) {
      if (this.previews[r.id]) continue;
      // eslint-disable-next-line no-await-in-loop -- a handful of resources
      const url = await store.readResourceDataUrl(r.ref);
      if (url) this.previews = { ...this.previews, [r.id]: url };
    }
  }

  private pick(): void {
    this.error = '';
    this.fileInput?.click();
  }

  private onFile(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      this.error = fileTooLargeMsg(
        (file.size / BYTES_PER_MB).toFixed(1),
        MAX_BYTES / BYTES_PER_MB
      );
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      this.pendingData = String(reader.result);
      this.pendingFile = file.name;
      if (this.importName.trim() === '') {
        this.importName = file.name.replace(KIND_CFG[this.kind].strip, '');
      }
    });
    reader.addEventListener('error', () => (this.error = localize(MSG.graphicsCatalog.fileUnreadable)));
    reader.readAsDataURL(file);
  }

  private async doImport(): Promise<void> {
    if (!this.store || this.pendingData === '' || this.busy) return;
    this.busy = true;
    this.error = '';
    const kind = this.kind;
    const resource = await this.store.importResource(
      kind,
      this.importName.trim(),
      this.pendingData,
      this.importLibrary.trim()
    );
    this.busy = false;
    if (!resource) {
      this.error = localize(MSG.graphicsCatalog.importFailed);
      return;
    }
    this.resetImport();
    // Add optimistically: the WS datapoint tree may lag behind the REST create.
    if (!this.lists[kind].some((r) => r.id === resource.id)) {
      this.lists = { ...this.lists, [kind]: [...this.lists[kind], resource] };
    }
    this.emitChange();
  }

  private async removeResource(r: GlbResource): Promise<void> {
    if (!this.store) return;
    await this.store.deleteResource(this.kind, r.ref);
    await this.reload();
    this.emitChange();
  }

  /** Reassign a resource's library (empty clears it). Optimistic — no reload so
   * the input keeps focus while typing. */
  private async changeLibrary(r: GlbResource, library: string): Promise<void> {
    const lib = library.trim();
    if (!this.store || (r.library ?? '') === lib) return;
    this.lists = {
      ...this.lists,
      [this.kind]: this.lists[this.kind].map((x) => (x.id === r.id ? { ...x, library: lib } : x))
    };
    await this.store.setResourceLibrary(r.id, lib);
    this.emitChange();
  }

  private resetImport(): void {
    this.importName = '';
    this.importLibrary = '';
    this.pendingData = '';
    this.pendingFile = '';
    this.error = '';
  }

  private emitChange(): void {
    this.dispatchEvent(new CustomEvent('wui:change', { bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .panel.res {
      width: 580px;
    }
    .import-row {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .import-row .imp-name {
      flex: 1;
    }
    .import-row .imp-lib {
      width: 11rem;
    }
    .lib-group {
      margin-top: 0.5rem;
    }
    .lib-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      margin: 0.4rem 0 0.25rem;
    }
    .res-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 0.5rem;
      max-height: 42vh;
      overflow-y: auto;
    }
    .res-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.4rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .res-thumb {
      width: 100%;
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--theme-color-1);
      border-radius: var(--theme-default-border-radius);
    }
    .res-thumb img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .res-name {
      width: 100%;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.8rem;
    }
    .res-lib {
      width: 100%;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .err {
      margin-top: 0.5rem;
      color: var(--theme-color-alarm);
      font-size: 0.85rem;
    }
  `;
}
