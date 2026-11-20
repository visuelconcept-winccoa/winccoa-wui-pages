// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The graphics of a symbol, picked from the atelier's catalogue: its 3D model (`glb`) or its icon
 * (`billboard`, SemiFab built-in or imported). Shared by the symbol dialog and the "Add a symbol"
 * wizard, so both show the same picker.
 *
 * Emits `wui:change` ({ value }, not bubbling: the URL / resource ref, undefined when cleared) and
 * `wui:resources` (bubbling: the page opens its graphics catalogue to import some). With `upload`, a 3D model
 * can also be uploaded on the spot (winccoa-fra-msp-stma#338): imported into the catalogue (same 2 MB limit),
 * picked at once, and announced by `wui:resourceadded` (bubbling, { kind, resource }) for the page to reload it.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GlbResource } from '../types.js';
import type { FleetStore } from '../data/fleet-store.js';
import { SEMIFAB_ICONS } from '../data/semifab-icons.js';
import { MSG, fileTooLargeMsg, localize, localizeDir, uploadGlbMsg } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import { BYTES_PER_MB, MAX_BYTES } from './mf-graphics-catalog.js';

/** Built-in SemiFab icon library + the "no library" bucket (billboard picker). */
const SEMIFAB_LIB = 'SemiFab';
const UNCLASSIFIED_LIB = '__none__';

interface IxValueEvent {
  detail: string | number;
}

@customElement('mf-graphic-picker')
export class MfGraphicPicker extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      :host {
        display: block;
      }
      .glb-row {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
      }
      .glb-row .glb-url {
        flex: 1;
      }
      .icon-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, 64px);
        gap: 0.4rem;
        max-height: 240px;
        overflow-y: auto;
        padding: 0.25rem;
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
      }
      .icon-cell {
        width: 64px;
        height: 64px;
        padding: 0.2rem;
        background: var(--theme-color-2);
        border: 2px solid transparent;
        border-radius: var(--theme-default-border-radius);
        cursor: pointer;
      }
      .icon-cell:hover {
        border-color: var(--theme-color-soft-bdr);
      }
      .icon-cell--active {
        border-color: var(--theme-color-primary);
        background: color-mix(in srgb, var(--theme-color-primary) 14%, transparent);
      }
      .icon-cell img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
      }
      .icon-cell ix-icon {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--theme-color-soft-text);
      }
      .bb-toolbar {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .bb-toolbar ix-select {
        flex: 1;
      }
      .upload-error {
        margin-top: 0.35rem;
        color: var(--theme-color-alarm);
        font-size: 0.85rem;
      }
      .upload-input {
        display: none;
      }
    `
  ];

  /** What is picked: a 3D model or an icon. */
  @property() kind: 'glb' | 'billboard' = 'glb';
  /** The current model / icon (MachineDef `glbUrl` / `billboardUrl`). */
  @property() value = '';
  @property({ attribute: false }) glbResources: GlbResource[] = [];
  @property({ attribute: false }) billboardResources: GlbResource[] = [];
  /** Reads the imported icons for their thumbnails, and imports an uploaded model. */
  @property({ attribute: false }) store: FleetStore | null = null;
  /** A 3D model can be uploaded on the spot (needs `store`). */
  @property({ type: Boolean }) upload = false;

  /** Selected icon library ('' until set from the value). */
  @state() private bbLibrary = '';
  /** Resolved data URLs for imported icon previews, keyed by resource id. */
  @state() private bbPreviews: Record<string, string> = {};
  /** Upload of a 3D model: under way, or its error ('' none). */
  @state() private uploading = false;
  @state() private uploadError = '';
  /** Models uploaded here, shown before the page reloads its catalogue. */
  @state() private uploaded: GlbResource[] = [];

  protected override willUpdate(changed: PropertyValues): void {
    // The library shown first: the picked icon's, else SemiFab.
    if (this.bbLibrary === '' || changed.has('kind')) this.bbLibrary = this.initialLibrary();
    if (this.kind === 'billboard' && (changed.has('billboardResources') || changed.has('store') || changed.has('kind'))) {
      void this.loadPreviews();
    }
  }

  override render(): TemplateResult {
    return this.kind === 'glb' ? this.renderGlb() : this.renderBillboard();
  }

  private renderGlb(): TemplateResult {
    const models = [...this.glbResources, ...this.uploaded.filter((u) => !this.glbResources.some((r) => r.ref === u.ref))];
    const canUpload = this.upload && !!this.store;
    return html`
      <div class="glb-row">
        <ix-select
          class="glb-url"
          label=${localize(MSG.machineDialog.glbResource)}
          allow-clear
          .value=${this.value}
          @valueChange=${(e: IxValueEvent) => this.change(e.detail ? String(e.detail) : undefined)}
        >
          ${models.map((r) => html`<ix-select-item label=${r.name} value=${r.ref}></ix-select-item>`)}
        </ix-select>
        ${canUpload
          ? html`<ix-button variant="secondary" ?disabled=${this.uploading} @click=${this.pickUpload}>
              <ix-icon name="upload" slot="icon"></ix-icon>${uploadGlbMsg(this.uploading ? 'busy' : 'idle')}
            </ix-button>`
          : ''}
        <ix-button variant="secondary" @click=${this.openResources}>
          <ix-icon name="folder" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.manage)}
        </ix-button>
      </div>
      ${canUpload ? html`<input class="upload-input" type="file" accept=".glb,.gltf" @change=${this.onUpload} />` : ''}
      ${this.uploadError ? html`<div class="upload-error">${this.uploadError}</div>` : ''}
      ${models.length === 0 && !canUpload ? html`<div class="hint">${localizeDir(MSG.machineDialog.glbEmpty)}</div>` : ''}
    `;
  }

  private pickUpload(): void {
    this.uploadError = '';
    this.renderRoot.querySelector<HTMLInputElement>('.upload-input')?.click();
  }

  /** A model uploaded: imported into the catalogue under its file name, then picked. */
  private readonly onUpload = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const store = this.store;
    if (!file || !store) return;
    if (file.size > MAX_BYTES) {
      this.uploadError = fileTooLargeMsg((file.size / BYTES_PER_MB).toFixed(1), MAX_BYTES / BYTES_PER_MB);
      return;
    }
    this.uploading = true;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const name = file.name.replace(/\.(glb|gltf)$/i, '') || file.name;
      void store.importResource('glb', name, String(reader.result)).then((resource) => {
        this.uploading = false;
        if (!resource) {
          this.uploadError = uploadGlbMsg('failed');
          return;
        }
        this.uploaded = [...this.uploaded, resource];
        this.change(resource.ref);
        this.dispatchEvent(new CustomEvent('wui:resourceadded', { detail: { kind: 'glb', resource }, bubbles: true, composed: true }));
      });
    });
    reader.addEventListener('error', () => {
      this.uploading = false;
      this.uploadError = localize(MSG.graphicsCatalog.fileUnreadable);
    });
    reader.readAsDataURL(file);
  };

  private renderBillboard(): TemplateResult {
    return html`
      <div class="hint">${localizeDir(MSG.machineDialog.billboardHint)}</div>
      <div class="bb-toolbar">
        <ix-select
          label=${localize(MSG.machineDialog.library)}
          .value=${this.bbLibrary}
          @valueChange=${(e: IxValueEvent) => (this.bbLibrary = String(e.detail))}
        >
          ${this.libraryOptions().map((o) => html`<ix-select-item label=${o.label} value=${o.value}></ix-select-item>`)}
        </ix-select>
        <ix-button class="link" variant="secondary" @click=${this.openResources}>
          <ix-icon name="folder" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.manageCatalog)}
        </ix-button>
      </div>
      ${this.renderGallery()}
    `;
  }

  /** Library options: SemiFab built-in, the imported libraries, then the unclassified ones. */
  private libraryOptions(): { value: string; label: string }[] {
    const opts = [{ value: SEMIFAB_LIB, label: localize(MSG.machineDialog.semifabBuiltin) }];
    const libs = [...new Set(this.billboardResources.map((r) => r.library).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    for (const l of libs) opts.push({ value: String(l), label: String(l) });
    if (this.billboardResources.some((r) => !r.library)) {
      opts.push({ value: UNCLASSIFIED_LIB, label: localize(MSG.machineDialog.importedNoLibrary) });
    }
    return opts;
  }

  /** Icon cells of the selected library. */
  private renderGallery(): TemplateResult {
    const sel = this.value;
    if (this.bbLibrary === SEMIFAB_LIB) {
      return html`<div class="icon-grid">
        ${SEMIFAB_ICONS.map(
          (url) => html`<button
            type="button"
            class="icon-cell ${sel === url ? 'icon-cell--active' : ''}"
            title=${url.split('/').pop() ?? ''}
            @click=${() => this.change(url)}
          >
            <img src=${url} alt="" loading="lazy" />
          </button>`
        )}
      </div>`;
    }
    const items = this.billboardResources.filter((r) =>
      this.bbLibrary === UNCLASSIFIED_LIB ? !r.library : r.library === this.bbLibrary
    );
    if (items.length === 0) return html`<div class="hint">${localizeDir(MSG.machineDialog.noResourceInLibrary)}</div>`;
    return html`<div class="icon-grid">
      ${items.map((r) => {
        const preview = this.bbPreviews[r.id];
        return html`<button
          type="button"
          class="icon-cell ${sel === r.ref ? 'icon-cell--active' : ''}"
          title=${r.name}
          @click=${() => this.change(r.ref)}
        >
          ${preview ? html`<img src=${preview} alt="" />` : html`<ix-icon name="image"></ix-icon>`}
        </button>`;
      })}
    </div>`;
  }

  /** The library of the picked icon, else SemiFab. */
  private initialLibrary(): string {
    const res = this.billboardResources.find((r) => r.ref === this.value);
    if (res) return res.library || UNCLASSIFIED_LIB;
    return SEMIFAB_LIB;
  }

  /** Resolve the imported icons' data URLs for the thumbnails. */
  private async loadPreviews(): Promise<void> {
    const store = this.store;
    if (!store) return;
    for (const r of this.billboardResources) {
      if (this.bbPreviews[r.id]) continue;
      // eslint-disable-next-line no-await-in-loop -- a handful of resources
      const url = await store.readResourceDataUrl(r.ref);
      if (url) this.bbPreviews = { ...this.bbPreviews, [r.id]: url };
    }
  }

  private change(value: string | undefined): void {
    this.value = value ?? '';
    this.dispatchEvent(new CustomEvent('wui:change', { detail: { value } }));
  }

  private openResources(): void {
    this.dispatchEvent(new CustomEvent('wui:resources', { bubbles: true, composed: true }));
  }
}
