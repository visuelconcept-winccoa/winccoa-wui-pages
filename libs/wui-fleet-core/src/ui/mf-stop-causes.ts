// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stop-cause catalogues manager (#74): several named catalogues, one datapoint each; the default one (the
 * single catalogue of before, used by every machine without a catalogue of its own) is always there. Each
 * has entries with a code, a description and a time classification (unplanned / planned). A catalogue is
 * chosen, created, duplicated, renamed or deleted (not the default; deletion confirmed by a second click), or made
 * the default one: its name and causes are swapped with the default's, on a second click. A catalogue not saved yet
 * takes its id from its name as it is renamed (the id names its datapoint).
 * All catalogues are saved together via {@link FleetStore.saveCatalogs}. Import / export (JSON) act on the
 * catalogue shown.
 * Emits `wui:close`.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import type { FleetStore } from '../data/fleet-store.js';
import {
  type StopCause,
  type StopCauseCatalog,
  type StopClassification
} from '../types.js';
import { defaultCatalog, newCatalogId, normaliseCatalogs } from '../stop-catalogs.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import { overlayClicked, overlayDown } from './overlay-dismiss.js';

interface IxValueEvent {
  detail: string;
}

interface IxCheckedEvent {
  detail: boolean;
}

/**
 * Classifications offered for a cause: a stop is planned or unplanned. 'production' stays
 * readable for a cause already classified so, but is no longer offered.
 */
const CLASSIFICATIONS: StopClassification[] = ['unplanned', 'planned'];

/** Localized label per stop classification (kit-local; the shared
 * `STOP_CLASSIFICATION_LABELS` map stays a plain-string data contract). */
const CLASSIFICATION_LABELS: Record<StopClassification, MultiLangString> = {
  unplanned: MSG.classification.unplanned,
  planned: MSG.classification.planned,
  production: MSG.classification.production
};

export class MfStopCauses extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) store: FleetStore | null = null;
  /** When false, the catalog is view-only: editing/saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private catalogs: StopCauseCatalog[] = [];
  /** The catalogue shown. */
  @state() private currentId = '';
  /** The catalogue waiting for a second click to be deleted. */
  @state() private confirmDeleteId = '';
  /** The catalogue waiting for a second click to become the default one. */
  @state() private confirmDefaultId = '';
  /** Ids of the catalogues as saved: one not saved yet takes its id from its name. */
  private savedIds = new Set<string>();
  @state() private busy = false;

  /** The catalogue shown (the default one when none chosen yet). */
  private get current(): StopCauseCatalog {
    return this.catalogs.find((c) => c.id === this.currentId) ?? defaultCatalog(this.catalogs);
  }

  /** The causes of the catalogue shown. */
  private get causes(): StopCause[] {
    return this.current.causes;
  }

  private set causes(causes: StopCause[]) {
    const id = this.current.id;
    this.catalogs = this.catalogs.map((c) => (c.id === id ? { ...c, causes } : c));
  }

  @query('.import-input') private importInput!: HTMLInputElement;

  override render(): TemplateResult {
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel causes" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.causes.title)}</ix-typography>
            <span class="head-spacer"></span>
            ${this.canEdit
              ? html`<ix-icon-button
                  ghost
                  icon="download"
                  title=${localize(MSG.causes.importJson)}
                  @click=${this.triggerImport}
                ></ix-icon-button>`
              : ''}
            <ix-icon-button
              ghost
              icon="upload"
              title=${localize(MSG.causes.exportJson)}
              ?disabled=${this.causes.length === 0}
              @click=${this.exportCauses}
            ></ix-icon-button>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            class="import-input"
            @change=${this.onImportFile}
          />
          <div class="panel-body">
            ${this.renderCatalogBar()}
            <div class="cause-row cause-head">
              <span>${localizeDir(MSG.causes.colCode)}</span><span>${localizeDir(MSG.causes.colDescription)}</span><span>${localizeDir(MSG.causes.colClassification)}</span><span>${localizeDir(MSG.causes.colDefault)}</span
              ><span></span>
            </div>
            ${this.causes.length === 0
              ? html`<div class="muted">${localizeDir(MSG.causes.empty)}</div>`
              : this.causes.map((c, i) => this.renderRow(c, i))}
            ${this.canEdit
              ? html`<ix-button class="add" variant="secondary" @click=${this.addCause}>
                  <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.causes.addCause)}
                </ix-button>`
              : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(MSG.causes.close)}</ix-button>
            ${this.canEdit
              ? html`<ix-button ?disabled=${this.busy} @click=${this.save}>${localizeDir(MSG.causes.save)}</ix-button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
  }

  /** Which catalogue (★ the default one) and its name; new, duplicate, make default, delete. */
  private renderCatalogBar(): TemplateResult {
    const ro = !this.canEdit;
    const cur = this.current;
    const isDefault = cur.isDefault === true;
    return html`
      <div class="catalog-bar">
        <ix-select
          label=${localize(MSG.causes.catalog)}
          title=${localize(MSG.causes.catalogDefaultHint)}
          .value=${cur.id}
          @valueChange=${(e: IxValueEvent) => {
            this.currentId = String(e.detail);
            this.confirmDeleteId = '';
            this.confirmDefaultId = '';
          }}
        >
          ${this.catalogs.map(
            (c) => html`<ix-select-item label=${c.isDefault ? `${c.name} ★` : c.name} value=${c.id}></ix-select-item>`
          )}
        </ix-select>
        <ix-input
          label=${localize(MSG.causes.catalogName)}
          ?disabled=${ro}
          .value=${cur.name}
          @valueChange=${(e: IxValueEvent) => this.renameCurrent(String(e.detail))}
        ></ix-input>
        ${ro
          ? ''
          : html`<span class="catalog-actions">
              <ix-button variant="secondary" @click=${() => this.addCatalog(false)}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.causes.newCatalog)}
              </ix-button>
              <ix-button variant="secondary" @click=${() => this.addCatalog(true)}>
                <ix-icon name="duplicate" slot="icon"></ix-icon>${localizeDir(MSG.causes.duplicateCatalog)}
              </ix-button>
              ${isDefault
                ? ''
                : html`<ix-button
                    variant=${this.confirmDefaultId === cur.id ? 'primary' : 'secondary'}
                    title=${localize(MSG.causes.makeDefaultHint)}
                    @click=${() => this.makeDefault()}
                  >
                    <ix-icon name="star" slot="icon"></ix-icon>${localizeDir(
                      this.confirmDefaultId === cur.id ? MSG.causes.confirmMakeDefault : MSG.causes.makeDefault
                    )}
                  </ix-button>`}
              <ix-button
                variant=${this.confirmDeleteId === cur.id ? 'primary' : 'secondary'}
                ?disabled=${isDefault}
                @click=${() => this.deleteCurrent()}
              >
                <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(
                  this.confirmDeleteId === cur.id ? MSG.causes.confirmDeleteCatalog : MSG.causes.deleteCatalog
                )}
              </ix-button>
            </span>`}
      </div>
    `;
  }

  /** Rename the catalogue shown; one not saved yet takes its id from the new name. */
  private renameCurrent(name: string): void {
    const id = this.current.id;
    const fresh = !this.savedIds.has(id) && this.current.isDefault !== true;
    const nextId = fresh ? newCatalogId(name, this.catalogs.filter((c) => c.id !== id).map((c) => c.id)) : id;
    this.catalogs = this.catalogs.map((c) => (c.id === id ? { ...c, id: nextId, name } : c));
    if (nextId !== id) {
      this.currentId = nextId;
      this.confirmDeleteId = '';
      this.confirmDefaultId = '';
    }
  }

  /**
   * Make the catalogue shown the default one, on a second click: the default datapoint takes its name and causes,
   * it takes the default's. Whoever had chosen it (a workcenter, a machine) then gets the former default's causes.
   */
  private makeDefault(): void {
    const cur = this.current;
    if (cur.isDefault) return;
    if (this.confirmDefaultId !== cur.id) {
      this.confirmDefaultId = cur.id;
      this.confirmDeleteId = '';
      return;
    }
    const def = defaultCatalog(this.catalogs);
    this.catalogs = this.catalogs.map((c) => {
      if (c.id === def.id) return { ...c, name: cur.name, causes: cur.causes };
      if (c.id === cur.id) return { ...c, name: def.name, causes: def.causes };
      return c;
    });
    this.currentId = def.id;
    this.confirmDefaultId = '';
  }

  /** A new catalogue, empty or a copy of the one shown; shown at once. */
  private addCatalog(copy: boolean): void {
    const name = copy ? `${localize(MSG.causes.copyOf)} ${this.current.name}` : localize(MSG.causes.newCatalogName);
    const id = newCatalogId(name, this.catalogs.map((c) => c.id));
    const causes = copy ? this.current.causes.map((c) => ({ ...c })) : [];
    this.catalogs = [...this.catalogs, { id, name, causes }];
    this.currentId = id;
    this.confirmDeleteId = '';
    this.confirmDefaultId = '';
  }

  /** Delete the catalogue shown, on a second click; never the default. */
  private deleteCurrent(): void {
    const cur = this.current;
    if (cur.isDefault) return;
    if (this.confirmDeleteId !== cur.id) {
      this.confirmDeleteId = cur.id;
      this.confirmDefaultId = '';
      return;
    }
    this.catalogs = this.catalogs.filter((c) => c.id !== cur.id);
    this.currentId = defaultCatalog(this.catalogs).id;
    this.confirmDeleteId = '';
  }

  private renderRow(c: StopCause, i: number): TemplateResult {
    const ro = !this.canEdit;
    return html`
      <div class="cause-row">
        <ix-input
          ?disabled=${ro}
          .value=${c.code}
          @valueChange=${(e: IxValueEvent) => this.patch(i, { code: String(e.detail) })}
        ></ix-input>
        <ix-input
          ?disabled=${ro}
          .value=${c.description}
          @valueChange=${(e: IxValueEvent) => this.patch(i, { description: String(e.detail) })}
        ></ix-input>
        <ix-select
          ?disabled=${ro}
          .value=${c.classification}
          @valueChange=${(e: IxValueEvent) =>
            this.patch(i, { classification: e.detail as StopClassification })}
        >
          ${[...CLASSIFICATIONS, ...(CLASSIFICATIONS.includes(c.classification) ? [] : [c.classification])].map(
            (k) => html`<ix-select-item label=${localize(CLASSIFICATION_LABELS[k])} value=${k}></ix-select-item>`
          )}
        </ix-select>
        <ix-toggle
          class="default-toggle"
          hide-text
          ?disabled=${ro}
          title=${localize(MSG.causes.defaultToggle)}
          ?checked=${c.isDefault === true}
          @checkedChange=${(e: IxCheckedEvent) => this.setDefault(i, e.detail)}
        ></ix-toggle>
        ${ro
          ? html`<span></span>`
          : html`<ix-icon-button
              ghost
              icon="trashcan"
              title=${localize(MSG.causes.remove)}
              @click=${() => this.removeCause(i)}
            ></ix-icon-button>`}
      </div>
    `;
  }

  private async reload(): Promise<void> {
    if (!this.store) return;
    this.catalogs = await this.store.listCatalogs();
    this.savedIds = new Set(this.catalogs.map((c) => c.id));
    this.currentId = defaultCatalog(this.catalogs).id;
  }

  private patch(index: number, patch: Partial<StopCause>): void {
    this.causes = this.causes.map((c, i) => (i === index ? { ...c, ...patch } : c));
  }

  /** Mark one entry as the catalog default (radio-style: clears the others). */
  private setDefault(index: number, on: boolean): void {
    this.causes = this.causes.map((c, i) => ({ ...c, isDefault: on && i === index }));
  }

  private addCause(): void {
    this.causes = [...this.causes, { code: '', description: '', classification: 'unplanned' }];
  }

  private removeCause(index: number): void {
    this.causes = this.causes.filter((_, i) => i !== index);
  }

  private async save(): Promise<void> {
    if (!this.store || this.busy) return;
    this.busy = true;
    const ok = await this.store.saveCatalogs(normaliseCatalogs(this.catalogs));
    this.busy = false;
    if (ok) this.close();
  }

  private exportCauses(): void {
    const json = JSON.stringify(this.causes, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `causes-arret-${this.current.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private triggerImport(): void {
    this.importInput.value = '';
    this.importInput.click();
  }

  private async onImportFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('Le fichier doit contenir un tableau de causes.');
      this.causes = onlyFirstDefault(parsed.map((c) => normaliseCause(c)));
    } catch {
      // Invalid file — keep the current catalog unchanged.
    }
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

const VALID_CLASSIFICATIONS = new Set<StopClassification>(['unplanned', 'planned', 'production']);

/** Coerce an imported entry into a valid {@link StopCause}. */
function normaliseCause(raw: unknown): StopCause {
  const entry = (raw ?? {}) as Partial<StopCause>;
  const classification = VALID_CLASSIFICATIONS.has(entry.classification as StopClassification)
    ? (entry.classification as StopClassification)
    : 'unplanned';
  return {
    code: String(entry.code ?? ''),
    description: String(entry.description ?? ''),
    classification,
    isDefault: entry.isDefault === true
  };
}

/** Keep only the first `isDefault` entry (the catalog has a single default). */
function onlyFirstDefault(causes: StopCause[]): StopCause[] {
  let seen = false;
  return causes.map((c) => {
    if (c.isDefault && !seen) {
      seen = true;
      return c;
    }
    return c.isDefault ? { ...c, isDefault: false } : c;
  });
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .panel.causes {
      width: 720px;
    }
    .catalog-bar {
      display: grid;
      grid-template-columns: 14rem 1fr;
      gap: 0.5rem 0.75rem;
      align-items: end;
      padding-bottom: 0.75rem;
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .catalog-actions {
      grid-column: 1 / -1;
      display: flex;
      gap: 0.5rem;
    }
    .cause-row {
      display: grid;
      grid-template-columns: 6rem 1fr 12rem 4rem auto;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.4rem;
    }
    .default-toggle {
      justify-self: center;
    }
    .cause-head {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
      font-weight: 600;
    }
    .add {
      margin-top: 0.5rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
      margin-bottom: 0.5rem;
    }
    .head-spacer {
      flex: 1;
    }
    .import-input {
      display: none;
    }
  `;
}

// Guarded registration: vendored into several self-contained page bundles
// (fleet-stop-analysis, asset-lifecycle-intelligence, machine-fleet-3d, …) that
// share one CustomElementRegistry per SPA session — an unguarded `define` would
// throw on the second page that loads.
if (!customElements.get('mf-stop-causes')) {
  customElements.define('mf-stop-causes', MfStopCauses);
}
