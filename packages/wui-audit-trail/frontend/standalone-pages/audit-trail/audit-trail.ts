/**
 * Audit Trail — Standalone page (WinCC OA WebUI Runtime).
 *
 * Shows, as a wide PIVOT table, the archived history of a chosen datapoint:
 * columns = the DP's structure elements, rows = timestamps (each archived change
 * is a row showing the carried-forward value of every column). The whole DP is
 * expected to be NGA-archived.
 *
 * Configuration (target DP, period, columns, live refresh) is edited in a popup
 * (gear button) and persisted in a dedicated `AuditTrail_Config` datapoint.
 * Registered at `/audit-trail` (component `wui-audit-trail`).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { AuditConfigStore } from './audit-trail/config-store.js';
import { buildPivot, structLeaves, type PivotResult } from './audit-trail/engine.js';
import {
  AUDIT_PERIOD_LABEL,
  DEFAULT_AUDIT_CONFIG,
  type AuditColumn,
  type AuditConfig,
  type AuditPeriod
} from './audit-trail/types.js';

const DAY_MS = 86_400_000;
const DATE_FORMAT = 'yyyy-MM-dd';
const END_OF_DAY_MS = DAY_MS - 1;
const DAYS_PER_WEEK = 7;
const PERIODS = Object.keys(AUDIT_PERIOD_LABEL) as AuditPeriod[];
const REFRESH_DEBOUNCE_MS = 1500;
const MAX_ROWS_OPTIONS = ['200', '500', '1000', '5000'];

function toDateStr(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseDate(str: string, endOfDay: boolean): Date | null {
  if (!str) return null;
  const d = new Date(`${str}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return endOfDay ? new Date(d.getTime() + END_OF_DAY_MS) : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

@customElement('wui-audit-trail')
export class WuiAuditTrail extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private config: AuditConfig = structuredClone(DEFAULT_AUDIT_CONFIG);
  /** All leaf elements of the current DP (available columns). */
  @state() private available: AuditColumn[] = [];
  @state() private result: PivotResult | null = null;
  @state() private loading = false;
  @state() private offline = false;
  @state() private configOpen = false;
  /** Working copy edited in the config popup (committed on "Appliquer"). */
  @state() private draft: AuditConfig = structuredClone(DEFAULT_AUDIT_CONFIG);
  @state() private draftAvailable: AuditColumn[] = [];
  @state() private elementsLoading = false;

  private readonly store = new AuditConfigStore();
  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private dpSub = new Subscription();
  private refreshDebounce = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dpSub.unsubscribe();
    window.clearTimeout(this.refreshDebounce);
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': 'Audit Trail', 'fr.utf8': 'Audit Trail' }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.renderToolbar()} ${this.renderOffline()} ${this.renderContent()}
      </div>
      ${this.configOpen ? this.renderConfig() : ''}
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.bootstrap();
  }

  private renderToolbar(): TemplateResult {
    const cols = this.activeColumns();
    return html`
      <div class="toolbar">
        <ix-button @click=${this.openConfig}>
          <ix-icon name="cogwheel" slot="icon"></ix-icon>Configurer
        </ix-button>
        <span class="dp-label">
          ${this.config.dpName
            ? html`<strong>${this.config.dpName}</strong> · ${cols.length} élément(s) · ${this.rangeLabel()}`
            : html`<em>Aucun datapoint configuré — cliquez « Configurer ».</em>`}
        </span>
        <span class="grow"></span>
        <ix-button
          variant="secondary"
          ?disabled=${this.loading || !this.config.dpName}
          @click=${() => void this.recompute()}
        >
          <ix-icon name="refresh" slot="icon"></ix-icon>Actualiser
        </ix-button>
      </div>
    `;
  }

  private renderOffline(): TemplateResult {
    if (!this.offline) return html``;
    return html`<div class="notice">
      <ix-icon name="info"></ix-icon>Mode hors-ligne : configuration non persistée (backend non
      connecté ou droits manquants).
    </div>`;
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (!this.config.dpName) {
      return html`<div class="center muted">
        Configurez un datapoint pour afficher son journal d'audit archivé.
      </div>`;
    }
    const cols = this.activeColumns();
    if (cols.length === 0) {
      return html`<div class="center muted">Aucun élément sélectionné pour ce datapoint.</div>`;
    }
    const result = this.result;
    if (!result || result.rows.length === 0) {
      return html`<div class="center muted">
        Aucune donnée d'historique sur la période. Vérifiez que le datapoint est archivé (NGA).
      </div>`;
    }
    return this.renderTable(cols, result);
  }

  private renderTable(cols: AuditColumn[], result: PivotResult): TemplateResult {
    return html`
      ${result.truncated
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>Historique tronqué aux ${this.config.maxRows} changements
            les plus récents.
          </div>`
        : ''}
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="sticky">Horodatage</th>
              ${cols.map((c) => html`<th title=${c.dpe}>${c.label}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${result.rows.map(
              (row) => html`<tr>
                <td class="sticky nowrap">${formatDateTime(row.t)}</td>
                ${row.values.map((v) => html`<td>${v ?? ''}</td>`)}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- config popup ----------------------------------------------------------

  private renderConfig(): TemplateResult {
    const d = this.draft;
    return html`
      <div class="overlay" @click=${this.closeConfig}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Configuration de l'audit trail</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.closeConfig}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="subhead">Datapoint cible</div>
            <div class="dp-row">
              <ix-input
                class="dp-input"
                placeholder="Nom du datapoint (ex. MachineSim_machine_…)"
                .value=${d.dpName}
                @valueChange=${(e: CustomEvent<string>) => (this.draft = { ...this.draft, dpName: String(e.detail) })}
              ></ix-input>
              <ix-button
                variant="secondary"
                ?disabled=${this.elementsLoading || d.dpName.trim() === ''}
                @click=${() => void this.loadElements()}
              >
                <ix-icon name="reload" slot="icon"></ix-icon>Charger les éléments
              </ix-button>
            </div>

            <div class="subhead">Période</div>
            <div class="period-row">
              <ix-select
                .value=${d.period}
                @valueChange=${(e: CustomEvent<string | string[]>) => this.onDraftPeriod(e.detail)}
              >
                ${PERIODS.map(
                  (p) => html`<ix-select-item value=${p} label=${AUDIT_PERIOD_LABEL[p]}></ix-select-item>`
                )}
              </ix-select>
              ${d.period === 'custom'
                ? html`
                    <ix-date-input
                      format=${DATE_FORMAT}
                      .value=${d.customStart}
                      @valueChange=${(e: CustomEvent<string>) => (this.draft = { ...this.draft, customStart: e.detail })}
                    ></ix-date-input>
                    <ix-date-input
                      format=${DATE_FORMAT}
                      .value=${d.customEnd}
                      @valueChange=${(e: CustomEvent<string>) => (this.draft = { ...this.draft, customEnd: e.detail })}
                    ></ix-date-input>
                  `
                : ''}
              <label class="inline">
                <span>Lignes max</span>
                <ix-select
                  .value=${String(d.maxRows)}
                  @valueChange=${(e: CustomEvent<string | string[]>) =>
                    (this.draft = { ...this.draft, maxRows: Number(Array.isArray(e.detail) ? e.detail[0] : e.detail) || DEFAULT_AUDIT_CONFIG.maxRows })}
                >
                  ${MAX_ROWS_OPTIONS.map((o) => html`<ix-select-item value=${o} label=${o}></ix-select-item>`)}
                </ix-select>
              </label>
            </div>

            <div class="toggle-row">
              <span>Rafraîchissement automatique (live)</span>
              <ix-toggle
                hide-text
                ?checked=${d.refresh}
                @checkedChange=${(e: CustomEvent<boolean>) => (this.draft = { ...this.draft, refresh: e.detail })}
              ></ix-toggle>
            </div>

            <div class="subhead">
              Colonnes / éléments
              ${this.draftAvailable.length > 0
                ? html`<span class="col-actions">
                    <ix-button variant="secondary" outline @click=${() => this.selectAllCols(true)}>Tout</ix-button>
                    <ix-button variant="secondary" outline @click=${() => this.selectAllCols(false)}>Aucun</ix-button>
                  </span>`
                : ''}
            </div>
            ${this.renderDraftCols()}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.closeConfig}>Annuler</ix-button>
            <ix-button @click=${() => void this.applyConfig()}>Appliquer</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  /** Column checkbox list inside the config popup. */
  private renderDraftCols(): TemplateResult {
    if (this.elementsLoading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.draftAvailable.length === 0) {
      return html`<div class="hint">Chargez les éléments du datapoint pour choisir les colonnes.</div>`;
    }
    return html`<div class="cols">
      ${this.draftAvailable.map(
        (c) => html`<label class="col-row">
          <ix-checkbox
            ?checked=${this.draftColChecked(c.dpe)}
            @checkedChange=${(e: CustomEvent<boolean>) => this.toggleDraftCol(c.dpe, e.detail)}
          ></ix-checkbox>
          <span title=${c.dpe}>${c.label}</span>
        </label>`
      )}
    </div>`;
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.config = await this.store.load();
    this.offline = this.store.offline;
    if (this.config.dpName) {
      this.available = await this.fetchElements(this.config.dpName);
      await this.recompute();
    }
  }

  /** Resolve a DP's structure elements as columns. Tries the type structure
   * (handles nested structs), then falls back to enumerating element DPEs
   * directly via `dpNames` (type-agnostic — works when only a DP name is known). */
  private async fetchElements(dpName: string): Promise<AuditColumn[]> {
    const name = dpName.trim();
    if (!name) return [];
    if (this.dpe) {
      try {
        const struct = await firstValueFrom(this.dpe.getDatapointTypes(name));
        if (typeof struct === 'string') return [{ dpe: name, label: '(valeur)' }];
        const leaves = structLeaves(struct, name).filter((l) => l !== name);
        if (leaves.length > 0) return leaves.map((dpe) => this.toColumn(dpe, name));
      } catch {
        // Not a type name — fall back to element enumeration below.
      }
    }
    if (this.api) {
      try {
        const raw = (await firstValueFrom(this.api.dpNames(`${name}.*`, ''))) as unknown;
        const list = this.toNameList(raw);
        if (list.length > 0) {
          return list.sort((a, b) => a.localeCompare(b)).map((dpe) => this.toColumn(dpe, name));
        }
      } catch {
        // ignore — no elements resolvable
      }
    }
    return [];
  }

  private toColumn(dpe: string, name: string): AuditColumn {
    const clean = dpe.endsWith('.') ? dpe.slice(0, -1) : dpe;
    let label = clean;
    if (clean.startsWith(name)) label = clean.slice(name.length) || '(valeur)';
    else if (clean.includes('.')) label = clean.slice(clean.indexOf('.'));
    return { dpe: clean, label };
  }

  /** dpNames returns either a string[] or a wrapper — normalise to string[]. */
  private toNameList(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
    if (raw && typeof raw === 'object') {
      const names = (raw as { names?: unknown }).names;
      if (Array.isArray(names)) return names.filter((x): x is string => typeof x === 'string');
    }
    return [];
  }

  /** Columns actually shown = the configured subset (or all when none chosen). */
  private activeColumns(): AuditColumn[] {
    const chosen = this.config.columns;
    if (chosen.length === 0) return this.available;
    const set = new Set(chosen);
    return this.available.filter((c) => set.has(c.dpe));
  }

  private resolveRange(): { start: Date; end: Date } {
    const end = new Date();
    const c = this.config;
    if (c.period === 'custom') {
      const s = parseDate(c.customStart, false) ?? new Date(end.getTime() - DAY_MS);
      const parsedEnd = parseDate(c.customEnd, true) ?? end;
      return { start: s, end: new Date(Math.min(parsedEnd.getTime(), end.getTime())) };
    }
    if (c.period === 'today') return { start: startOfDay(end), end };
    const days = c.period === '24h' ? 1 : (c.period === '7d' ? DAYS_PER_WEEK : 30);
    return { start: new Date(end.getTime() - days * DAY_MS), end };
  }

  private rangeLabel(): string {
    const { start, end } = this.resolveRange();
    return `${formatDateTime(start.getTime())} → ${formatDateTime(end.getTime())}`;
  }

  private async recompute(): Promise<void> {
    const cols = this.activeColumns();
    if (!this.config.dpName || cols.length === 0) {
      this.result = null;
      return;
    }
    this.loading = true;
    const { start, end } = this.resolveRange();
    this.result = await buildPivot(this.api, cols, start, end, this.config.maxRows);
    this.loading = false;
    this.connectLive(cols);
  }

  /** Live re-query (debounced) when any shown element changes — like the 3D view. */
  private connectLive(cols: AuditColumn[]): void {
    this.dpSub.unsubscribe();
    this.dpSub = new Subscription();
    const api = this.api;
    if (!api || !this.config.refresh || cols.length === 0) return;
    try {
      this.dpSub = api.dpConnect(cols.map((c) => c.dpe), true).subscribe({
        next: () => this.scheduleRefresh(),
        error: () => this.scheduleRefresh()
      });
    } catch {
      // A non-connectable element — skip live updates, manual refresh still works.
    }
  }

  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshDebounce);
    this.refreshDebounce = window.setTimeout(() => {
      void this.recomputeSilent();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async recomputeSilent(): Promise<void> {
    const cols = this.activeColumns();
    if (cols.length === 0) return;
    const { start, end } = this.resolveRange();
    this.result = await buildPivot(this.api, cols, start, end, this.config.maxRows);
  }

  // --- config popup handlers -------------------------------------------------

  private openConfig(): void {
    this.draft = structuredClone(this.config);
    this.draftAvailable = [...this.available];
    this.configOpen = true;
  }

  private closeConfig(): void {
    this.configOpen = false;
  }

  private onDraftPeriod(value: string | string[]): void {
    const v = (Array.isArray(value) ? value[0] : value) as AuditPeriod;
    if (!(v in AUDIT_PERIOD_LABEL)) return;
    const patch: Partial<AuditConfig> = { period: v };
    if (v === 'custom' && (this.draft.customStart === '' || this.draft.customEnd === '')) {
      const now = new Date();
      patch.customEnd = toDateStr(now);
      patch.customStart = toDateStr(new Date(now.getTime() - DAYS_PER_WEEK * DAY_MS));
    }
    this.draft = { ...this.draft, ...patch };
  }

  private async loadElements(): Promise<void> {
    this.elementsLoading = true;
    this.draftAvailable = await this.fetchElements(this.draft.dpName);
    // Default to all columns when none are selected yet for this DP.
    if (this.draft.columns.length === 0) {
      this.draft = { ...this.draft, columns: this.draftAvailable.map((c) => c.dpe) };
    }
    this.elementsLoading = false;
  }

  private draftColChecked(dpe: string): boolean {
    return this.draft.columns.length === 0 || this.draft.columns.includes(dpe);
  }

  private toggleDraftCol(dpe: string, on: boolean): void {
    const base =
      this.draft.columns.length === 0 ? this.draftAvailable.map((c) => c.dpe) : this.draft.columns;
    const set = new Set(base);
    if (on) set.add(dpe);
    else set.delete(dpe);
    this.draft = { ...this.draft, columns: [...set] };
  }

  private selectAllCols(all: boolean): void {
    this.draft = { ...this.draft, columns: all ? this.draftAvailable.map((c) => c.dpe) : [] };
    // Empty array means "all" elsewhere; use a sentinel for an explicit empty set.
    if (!all) this.draft = { ...this.draft, columns: ['__none__'] };
  }

  private async applyConfig(): Promise<void> {
    // Normalise the "none" sentinel back to an empty visible set.
    const columns = this.draft.columns.includes('__none__') ? [] : this.draft.columns;
    this.config = { ...this.draft, dpName: this.draft.dpName.trim(), columns };
    this.available = this.draftAvailable.length > 0 ? [...this.draftAvailable] : this.available;
    if (this.available.length === 0 && this.config.dpName) {
      this.available = await this.fetchElements(this.config.dpName);
    }
    this.configOpen = false;
    await this.store.save(this.config);
    this.offline = this.store.offline;
    await this.recompute();
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      color: var(--theme-color-std-text);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      flex: 1;
      min-height: 0;
      padding: 1rem;
      box-sizing: border-box;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .grow {
      flex: 1;
    }
    .dp-label {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-warning) 18%, transparent);
      border: 1px solid var(--theme-color-warning);
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .table-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .tbl {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
    .tbl th,
    .tbl td {
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      border-right: 1px solid var(--theme-color-soft-bdr);
      padding: 0.3rem 0.55rem;
      text-align: left;
      white-space: nowrap;
    }
    .tbl thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--theme-color-2);
      font-weight: 600;
    }
    .tbl .sticky {
      position: sticky;
      left: 0;
      background: var(--theme-color-2);
      z-index: 1;
    }
    .tbl thead th.sticky {
      z-index: 2;
    }
    .nowrap {
      white-space: nowrap;
    }
    .tbl tbody tr:hover td {
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .panel {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      width: 680px;
      max-width: 96vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-body {
      padding: 1rem;
      overflow-y: auto;
    }
    .panel-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .subhead {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      margin: 0.75rem 0 0.4rem;
      color: var(--theme-color-soft-text);
    }
    .col-actions {
      display: inline-flex;
      gap: 0.25rem;
      margin-left: auto;
    }
    .dp-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .dp-input {
      flex: 1;
    }
    .period-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .hint {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.25rem 0.75rem;
      max-height: 240px;
      overflow: auto;
      padding: 0.25rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .col-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
}
