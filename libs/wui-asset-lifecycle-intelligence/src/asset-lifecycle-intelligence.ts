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
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { query, state } from 'lit/decorators.js';
import {
  ASSET_AI_SUGGESTIONS,
  buildAssetAiSystemPrompt
} from './asset-lifecycle-intelligence/data/ai-context.js';
import { mergeAmlAsset, parseAmlAssets } from './asset-lifecycle-intelligence/data/aml-import.js';
import { AssetStore } from './asset-lifecycle-intelligence/data/asset-store.js';
import { exportCsv, exportJson, parseAssets } from './asset-lifecycle-intelligence/data/io.js';
import type { Asset } from './asset-lifecycle-intelligence/types.js';
import './asset-lifecycle-intelligence/ui/ali-asset-dialog.js';
import './asset-lifecycle-intelligence/ui/ali-asset-table.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './asset-lifecycle-intelligence/ui/ali-kpi-bar.js';
// Reuse the shared AI assistant chat (POST /api/ai/chat → MSA AiAssistant manager).
import '@visuelconcept/wui-ai-kit/ui/mf-ai-prompt.js';

export class WuiAssetLifecycle extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private assets: Asset[] = [];
  @state() private loading = true;
  @state() private offline = false;
  /** Open editor target: an existing asset, `null` for "new", or undefined = closed. */
  @state() private editing: Asset | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';
  @state() private importInfo = '';

  @query('.import-input') private importInput!: HTMLInputElement;
  @query('.aml-input') private amlInput!: HTMLInputElement;

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
          <div class="toolbar">
            <ali-kpi-bar class="grow" .assets=${this.assets}></ali-kpi-bar>
            <div class="actions">
              <ix-button variant="secondary" @click=${this.triggerAmlImport}>
                <ix-icon name="upload" slot="icon"></ix-icon>Importer AML (TIA)
              </ix-button>
              <ix-button variant="secondary" @click=${this.triggerImport}>
                <ix-icon name="upload" slot="icon"></ix-icon>Importer JSON
              </ix-button>
              <ix-button
                variant="secondary"
                ?disabled=${this.assets.length === 0}
                @click=${this.onExportJson}
              >
                <ix-icon name="download" slot="icon"></ix-icon>Export JSON
              </ix-button>
              <ix-button
                variant="secondary"
                ?disabled=${this.assets.length === 0}
                @click=${this.onExportCsv}
              >
                <ix-icon name="download" slot="icon"></ix-icon>Export CSV
              </ix-button>
              <ix-button @click=${this.openCreate}>
                <ix-icon name="plus" slot="icon"></ix-icon>Nouvel actif
              </ix-button>
              <mf-ai-prompt
                .system=${buildAssetAiSystemPrompt(this.assets)}
                .suggestions=${ASSET_AI_SUGGESTIONS}
              ></mf-ai-prompt>
            </div>
          </div>
          <input
            class="import-input"
            type="file"
            accept="application/json,.json"
            hidden
            @change=${this.onImportFile}
          />
          <input
            class="aml-input"
            type="file"
            accept=".aml,.xml"
            hidden
            @change=${this.onImportAmlFile}
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
                <ix-icon name="info"></ix-icon>Mode hors-ligne : modifications non persistées dans
                les datapoints (backend indisponible ou droits d'écriture manquants).
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
            message=${`Supprimer l'actif « ${this.assetName(this.deletingId)} » ?`}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.assets.length === 0) {
      return html`
        <div class="center empty">
          <ix-typography>Aucun actif géré pour l'instant.</ix-typography>
          <ix-button variant="secondary" @click=${this.importDemo}>
            <ix-icon name="add" slot="icon"></ix-icon>Importer le parc de démonstration
          </ix-button>
        </div>
      `;
    }
    return html`
      <ali-asset-table
        .assets=${this.assets}
        @wui:edit=${(e: CustomEvent<{ id: string }>) => this.openEdit(e.detail.id)}
        @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
      ></ali-asset-table>
    `;
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

  private async importDemo(): Promise<void> {
    this.loading = true;
    this.assets = await this.store.importDemo();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private onExportJson(): void {
    exportJson(this.assets);
  }

  private onExportCsv(): void {
    exportCsv(this.assets);
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
    let parsed: Asset[];
    try {
      parsed = parseAssets(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Import échoué.';
      return;
    }
    this.importError = '';
    this.loading = true;
    for (const asset of parsed) {
      const exists = asset.id !== '' && this.assets.some((a) => a.id === asset.id);
      await (exists ? this.store.saveAsset(asset) : this.store.createAsset(asset));
    }
    this.assets = [...(await this.store.listAssets())];
    this.offline = this.store.offline;
    this.loading = false;
  }

  private triggerAmlImport(): void {
    this.importError = '';
    this.importInfo = '';
    this.amlInput.value = '';
    this.amlInput.click();
  }

  private async onImportAmlFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError = '';
    this.importInfo = '';
    let result: ReturnType<typeof parseAmlAssets>;
    try {
      result = parseAmlAssets(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : 'Import AML échoué.';
      return;
    }
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
    this.importInfo = `Projet « ${result.project} » importé : ${created} actif(s) ajouté(s), ${updated} mis à jour.`;
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
    .toolbar {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    ali-asset-table {
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
  `;
}
