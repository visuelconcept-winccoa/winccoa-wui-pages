/**
 * Asset Lifecycle Intelligence — Standalone page (WinCC OA WebUI Runtime).
 *
 * First-level asset-management functionality from the Visuel Concept concept
 * deck: a managed inventory of industrial assets, each carrying field identity
 * (MLFB, station, IP, firmware) and the structured inputs that feed a composite
 * obsolescence/risk score (0–100, see {@link ./asset-lifecycle-intelligence/risk.ts}).
 * The page shows a KPI summary, a sortable risk-ranked table, and create/edit/
 * delete dialogs.
 *
 * Each asset is persisted as one WinCC OA datapoint (auto-created DP type
 * `AssetLifecycle_Asset`) via {@link AssetStore}, with a transparent in-memory
 * fallback (seeded with demo assets) when the backend is unreachable.
 *
 * This file is built as a separate entry point (auto-discovered by build:pages)
 * and loaded at runtime via dynamic import; dependencies resolve via import maps.
 */
/* eslint-disable max-lines -- single standalone page component (toolbar + dialogs + handlers) */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import {
  MSG,
  amlImportedMsg,
  bulkSummaryMsg,
  confirmDeleteAllMsg,
  confirmDeleteMsg,
  localize,
  localizeDir
} from './asset-lifecycle-intelligence/i18n.js';
import {
  assetPatchFromProductInfo,
  bulkLookupProductInfo,
  uniqueMlfbs,
  type ProductInfoResult
} from './asset-lifecycle-intelligence/data/product-info.js';
import {
  assetAiSuggestions,
  buildAssetAiSystemPrompt
} from './asset-lifecycle-intelligence/data/ai-context.js';
import { mergeAmlAsset, parseAmlAssets } from './asset-lifecycle-intelligence/data/aml-import.js';
import { AssetStore } from './asset-lifecycle-intelligence/data/asset-store.js';
import { DEMO_DOMAIN_KEYS, type DemoDomain } from './asset-lifecycle-intelligence/data/demo-assets.js';
import { exportCsv, exportJson, parseAssets } from './asset-lifecycle-intelligence/data/io.js';
import type { Asset } from './asset-lifecycle-intelligence/types.js';
import './asset-lifecycle-intelligence/ui/ali-asset-dialog.js';
import { TABLE_COLUMNS } from './asset-lifecycle-intelligence/ui/ali-asset-table.js';
import './asset-lifecycle-intelligence/ui/ali-asset-tree.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './asset-lifecycle-intelligence/ui/ali-kpi-bar.js';
import './asset-lifecycle-intelligence/ui/ali-product-info-config-dialog.js';
// Reuse the shared AI assistant chat (POST /api/ai/chat → MSA AiAssistant manager).
import '@visuelconcept/wui-ai-kit/ui/mf-ai-prompt.js';

/** Default visible (toggleable) columns — every column shown initially. */
const DEFAULT_VISIBLE_COLUMNS = TABLE_COLUMNS.map((column) => column.key);

export class WuiAssetLifecycle extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private assets: Asset[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Open editor target: an existing asset, `null` for "new", or undefined = closed. */
  @state() private editing: Asset | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  /** When true, the "delete all" confirmation is open. */
  @state() private deletingAll = false;
  @state() private importError = '';
  @state() private importInfo = '';
  /** Live text filter applied to the list (table + tree). */
  @state() private search = '';
  /** Visible (toggleable) table columns. */
  @state() private visibleColumns: string[] = [...DEFAULT_VISIBLE_COLUMNS];
  /** Export-format mini-menu visibility. */
  @state() private exportMenuOpen = false;
  /** Inventory view mode. */
  @state() private view: 'table' | 'tree' = 'table';
  /** Bulk Siemens cross-reference run state. */
  @state() private bulkRunning = false;
  @state() private bulkDone = 0;
  @state() private bulkTotal = 0;
  /** Product Information Hub config dialog visibility. */
  @state() private configOpen = false;
  /** canPublish — gates the configuration gear. */
  @state() private canConfig = canEditFleet();

  private permSub = new Subscription();

  @query('.import-input') private importInput!: HTMLInputElement;

  private readonly store = new AssetStore();

  // eslint-disable-next-line max-lines-per-function -- single page template
  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Asset Lifecycle Intelligence',
                'fr': 'Intelligence du cycle de vie des actifs',
                'de_AT.utf8': 'Asset-Lebenszyklus-Intelligenz'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          <ali-kpi-bar .assets=${this.assets}></ali-kpi-bar>
          <div class="controls">
            <div class="view-toggle">
              <ix-button
                variant=${this.view === 'table' ? 'primary' : 'secondary'}
                @click=${() => (this.view = 'table')}
              >
                <ix-icon name="table" slot="icon"></ix-icon>${localizeDir(MSG.view.table)}
              </ix-button>
              <ix-button
                variant=${this.view === 'tree' ? 'primary' : 'secondary'}
                @click=${() => (this.view = 'tree')}
              >
                <ix-icon name="tree" slot="icon"></ix-icon>${localizeDir(MSG.view.tree)}
              </ix-button>
            </div>
            <span class="grow"></span>
            <div class="actions">
              <ix-button variant="secondary" title=${localize(MSG.page.importHint)} @click=${this.triggerImport}>
                <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.page.import)}
              </ix-button>
              <div class="export-wrap">
                <ix-button
                  variant="secondary"
                  ?disabled=${this.assets.length === 0}
                  @click=${() => (this.exportMenuOpen = !this.exportMenuOpen)}
                >
                  <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.page.export)} ▾
                </ix-button>
                ${this.exportMenuOpen
                  ? html`<div class="menu">
                      <button type="button" @click=${() => this.doExport('json')}>${localizeDir(MSG.page.exportJson)}</button>
                      <button type="button" @click=${() => this.doExport('csv')}>${localizeDir(MSG.page.exportCsv)}</button>
                    </div>`
                  : nothing}
              </div>
              <ix-button
                variant="secondary"
                ?disabled=${this.bulkRunning || this.assets.length === 0}
                @click=${() => void this.refreshAllProductInfo()}
              >
                <ix-icon name="cloud-download" slot="icon"></ix-icon>${localizeDir(MSG.page.refreshAll)}
              </ix-button>
              ${this.bulkRunning
                ? html`<span class="bulk-progress">
                    <ix-spinner size="small"></ix-spinner>${this.bulkDone}/${this.bulkTotal}
                  </span>`
                : nothing}
              <ix-button @click=${this.openCreate}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.page.newAsset)}
              </ix-button>
              ${this.canConfig
                ? html`
                    <ix-button
                      variant="secondary"
                      outline
                      ?disabled=${this.assets.length === 0}
                      @click=${() => (this.deletingAll = true)}
                    >
                      <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(MSG.page.deleteAll)}
                    </ix-button>
                    <ix-icon-button
                      outline
                      icon="cogwheel"
                      title=${localize(MSG.config.gear)}
                      @click=${() => (this.configOpen = true)}
                    ></ix-icon-button>
                  `
                : nothing}
              <mf-ai-prompt
                .system=${buildAssetAiSystemPrompt(this.assets)}
                .suggestions=${assetAiSuggestions()}
              ></mf-ai-prompt>
            </div>
          </div>
          <input
            class="import-input"
            type="file"
            accept="application/json,.json,.aml,.xml"
            hidden
            @change=${this.onImportFile}
          />

          ${this.importError
            ? html`<div class="notice error">
                <ix-icon name="warning"></ix-icon>${this.importError}
              </div>`
            : nothing}
          ${this.importInfo
            ? html`<div class="notice info">
                <ix-icon name="info"></ix-icon>${this.importInfo}
              </div>`
            : nothing}
          ${this.offline
            ? html`<div class="notice">
                <ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}
              </div>`
            : nothing}
          ${!this.loading && this.assets.length > 0
            ? html`<div class="subcontrols">
                <input
                  class="search"
                  type="search"
                  placeholder=${localize(MSG.page.search)}
                  .value=${this.search}
                  @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
                />
                <span class="grow"></span>
                ${this.view === 'table'
                  ? html`<ix-select
                      class="col-select"
                      mode="multiple"
                      placeholder=${localize(MSG.page.columns)}
                      .value=${this.visibleColumns}
                      @valueChange=${(e: CustomEvent<string | string[]>) => this.onColumns(e.detail)}
                    >
                      ${TABLE_COLUMNS.map(
                        (c) => html`<ix-select-item value=${c.key} label=${localize(c.label)}></ix-select-item>`
                      )}
                    </ix-select>`
                  : nothing}
              </div>`
            : nothing}
          ${this.renderContent()}
        </div>
      </div>

      ${this.editing === undefined
        ? nothing
        : html`<ali-asset-dialog
            .asset=${this.editing}
            @wui:save=${this.onSave}
            @wui:cancel=${this.closeDialog}
          ></ali-asset-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteMsg(this.assetName(this.deletingId))}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
      ${this.configOpen
        ? html`<ali-product-info-config-dialog
            @wui:close=${() => (this.configOpen = false)}
          ></ali-product-info-config-dialog>`
        : nothing}
      ${this.deletingAll
        ? html`<wui-confirm-dialog
            message=${confirmDeleteAllMsg(this.assets.length)}
            @wui:confirm=${this.onDeleteAllConfirm}
            @wui:cancel=${() => (this.deletingAll = false)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.permSub = canEditFleet$().subscribe((allowed) => (this.canConfig = allowed));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.assets.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>${localizeDir(MSG.page.empty)}</ix-typography>
          <ix-typography format="label">${localizeDir(MSG.demo.prompt)}</ix-typography>
          <div class="demo-domains">
            ${DEMO_DOMAIN_KEYS.map(
              (domain) => html`
                <ix-button variant="secondary" @click=${() => void this.importDemo(domain)}>
                  <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.demo[domain])}
                </ix-button>
              `
            )}
          </div>
        </div>
      `;
    }
    const assets = this.filteredAssets();
    if (assets.length === 0) {
      return html`<div class="center empty"><ix-typography>${localizeDir(MSG.page.noMatch)}</ix-typography></div>`;
    }
    if (this.view === 'tree') {
      return html`
        <ali-asset-tree
          .assets=${assets}
          @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        ></ali-asset-tree>
      `;
    }
    return html`
      <ali-asset-table
        .assets=${assets}
        .visibleColumns=${this.visibleColumns}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
      ></ali-asset-table>
    `;
  }

  /** Assets matching the live text search (name / MLFB / station / area / group / notes). */
  private filteredAssets(): Asset[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.assets;
    return this.assets.filter((a) =>
      [a.name, a.mlfb, a.station, a.area, a.assetGroup, a.notes].some((f) =>
        String(f ?? '').toLowerCase().includes(q)
      )
    );
  }

  private onColumns(value: string | string[]): void {
    if (Array.isArray(value)) {
      this.visibleColumns = value;
      return;
    }
    this.visibleColumns = value ? [value] : [];
  }

  private doExport(format: 'json' | 'csv'): void {
    this.exportMenuOpen = false;
    (format === 'json' ? exportJson : exportCsv)(this.assets);
  }

  private async onDeleteAllConfirm(): Promise<void> {
    this.deletingAll = false;
    this.loading = true;
    await this.store.deleteAll();
    this.assets = [];
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.assets = await this.store.listAssets();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private openCreate(): void {
    this.editing = null;
  }

  private openEdit(id: string): void {
    this.editing = this.assets.find((a) => a.id === id) ?? null;
  }

  private closeDialog(): void {
    this.editing = undefined;
  }

  private async onSave(event: CustomEvent<Asset>): Promise<void> {
    const asset = event.detail;
    if (this.editing) {
      await this.store.saveAsset(asset);
      this.assets = this.assets.map((a) => (a.id === asset.id ? asset : a));
    } else {
      const created = await this.store.createAsset(asset);
      this.assets = [...this.assets, created];
    }
    this.offline = this.store.offline;
    this.editing = undefined;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.deleteAsset(id);
    this.assets = this.assets.filter((a) => a.id !== id);
    this.deletingId = null;
  }

  private async importDemo(domain: DemoDomain): Promise<void> {
    this.loading = true;
    this.assets = await this.store.importDemo(domain);
    this.offline = this.store.offline;
    this.loading = false;
  }

  /**
   * Cross-reference every UNIQUE MLFB with Siemens (one lookup per distinct MLFB,
   * bounded concurrency) and apply each result to all assets sharing that MLFB,
   * persisting only the rows that actually change.
   */
  private async refreshAllProductInfo(): Promise<void> {
    const mlfbs = uniqueMlfbs(this.assets);
    this.importError = '';
    if (mlfbs.length === 0) {
      this.importInfo = localize(MSG.page.noMlfb);
      return;
    }
    this.importInfo = '';
    this.bulkTotal = mlfbs.length;
    this.bulkDone = 0;
    this.bulkRunning = true;
    try {
      const results = await bulkLookupProductInfo(mlfbs, {
        onProgress: ({ done }) => (this.bulkDone = done)
      });
      let obsUnavailable = 0;
      for (const r of results.values()) {
        if (!r.obsolescence) obsUnavailable += 1;
      }
      const updated = await this.applyBulkResults(results);
      this.assets = await this.store.listAssets();
      this.offline = this.store.offline;
      this.importInfo = bulkSummaryMsg(mlfbs.length, updated, obsUnavailable);
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.page.bulkFailed);
    } finally {
      this.bulkRunning = false;
    }
  }

  /** Apply bulk lookup results to every asset sharing a looked-up MLFB; returns the rows changed. */
  private async applyBulkResults(results: Map<string, ProductInfoResult>): Promise<number> {
    let updated = 0;
    for (const asset of this.assets) {
      const key = asset.mlfb.trim();
      const result = key === '' ? undefined : results.get(key);
      if (!result) continue;
      const next = { ...asset, ...assetPatchFromProductInfo(result) };
      if (JSON.stringify(next) === JSON.stringify(asset)) continue;
      await this.store.saveAsset(next);
      updated += 1;
    }
    return updated;
  }

  private triggerImport(): void {
    this.importError = '';
    this.importInfo = '';
    this.importInput.value = '';
    this.importInput.click();
  }

  /** Single import entry point — routes by file extension (.json vs .aml/.xml). */
  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError = '';
    this.importInfo = '';
    const isAml = /\.(aml|xml)$/i.test(file.name);
    try {
      const text = await file.text();
      await (isAml ? this.importAml(text) : this.importJson(text));
    } catch (error) {
      this.loading = false;
      this.importError =
        error instanceof Error ? error.message : localize(isAml ? MSG.page.importAmlFailed : MSG.page.importFailed);
    }
  }

  private async importJson(text: string): Promise<void> {
    const parsed = parseAssets(text);
    this.loading = true;
    for (const asset of parsed) {
      const exists = asset.id !== '' && this.assets.some((a) => a.id === asset.id);
      await (exists ? this.store.saveAsset(asset) : this.store.createAsset(asset));
    }
    this.assets = [...(await this.store.listAssets())];
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async importAml(text: string): Promise<void> {
    const result = parseAmlAssets(text);
    // Index existing assets of this project by their stable TIA key.
    const byKey = new Map<string, Asset>();
    for (const a of this.assets) {
      if (a.tiaProject === result.project && a.tiaKey !== '') byKey.set(a.tiaKey, a);
    }
    let created = 0;
    let updated = 0;
    this.loading = true;
    for (const incoming of result.assets) {
      const existing = byKey.get(incoming.tiaKey);
      if (existing) {
        await this.store.saveAsset(mergeAmlAsset(existing, incoming));
        updated += 1;
      } else {
        await this.store.createAsset(incoming);
        created += 1;
      }
    }
    this.assets = [...(await this.store.listAssets())];
    this.offline = this.store.offline;
    this.loading = false;
    this.importInfo = amlImportedMsg(result.project, created, updated);
  }

  private assetName(id: string): string {
    return this.assets.find((a) => a.id === id)?.name ?? id;
  }
}

if (!customElements.get('wui-asset-lifecycle')) {
  customElements.define('wui-asset-lifecycle', WuiAssetLifecycle);
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
    ali-kpi-bar {
      flex: none;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      padding-bottom: 0.5rem;
    }
    .controls .grow {
      flex: 1;
    }
    .view-toggle {
      display: inline-flex;
      gap: 0.25rem;
    }
    .search {
      min-width: 12rem;
      box-sizing: border-box;
      padding: 0.4rem 0.6rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .col-select {
      min-width: 12rem;
    }
    .subcontrols {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding-bottom: 0.5rem;
    }
    .subcontrols .grow {
      flex: 1;
    }
    .export-wrap {
      position: relative;
      display: inline-flex;
    }
    .menu {
      position: absolute;
      top: calc(100% + 0.25rem);
      left: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      min-width: 10rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }
    .menu button {
      text-align: left;
      padding: 0.5rem 0.75rem;
      border: none;
      background: none;
      color: var(--theme-color-std-text);
      font: inherit;
      cursor: pointer;
    }
    .menu button:hover {
      background: var(--theme-color-1);
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .bulk-progress {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    ali-asset-table,
    ali-asset-tree {
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
    .notice.info {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
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
    .demo-domains {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: center;
    }
  `;
}
