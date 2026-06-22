/**
 * Audit Trail — Standalone page (WinCC OA WebUI Runtime).
 *
 * GxP audit-trail viewer over the fixed `_AuditTrail` datapoint structure
 * (time / username / item / action / oldval → newval / reason / …). The page:
 *   • lists the project's `_AuditTrail` datapoints and shows the archived (NGA)
 *     history of the selected one as a log table (one row per archived record);
 *   • defaults to the rolling last 24 h in live mode (auto-refresh) and offers a
 *     start/end datetime range for an arbitrary interval;
 *   • exports the displayed log to CSV / JSON and prints it;
 *   • manages the `_AuditTrail` datapoints (create — always archived — reassign
 *     archive group, delete) via the `at-manage-dialog` popup.
 *
 * Records are written by WinCC OA's audit mechanism / panels / scripts, not by
 * this page. Registered at `/audit-trail` (component `wui-audit-trail`).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import './audit-trail/at-manage-dialog.js';
import { AuditConfigStore } from './audit-trail/config-store.js';
import { listAuditDps } from './audit-trail/dp-admin.js';
import { buildPivot, type PivotResult } from './audit-trail/engine.js';
import { exportAuditCsv, exportAuditJson, printAudit } from './audit-trail/export.js';
import {
  AUDIT_DP_TYPE,
  AUDIT_FIELDS,
  DEFAULT_AUDIT_CONFIG,
  LIVE_WINDOW_MS,
  type AuditColumn,
  type AuditConfig
} from './audit-trail/types.js';

const REFRESH_DEBOUNCE_MS = 1500;
const SECONDS_THRESHOLD = 1e12;

function pad(n: number): string {
  return `${n}`.padStart(2, '0');
}

/** A `Date` → `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time). */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/** Best-effort conversion of an archived `time` value to epoch ms. */
function toMsLoose(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v < SECONDS_THRESHOLD ? v * 1000 : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function asString(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

@customElement('wui-audit-trail')
export class WuiAuditTrail extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private config: AuditConfig = structuredClone(DEFAULT_AUDIT_CONFIG);
  @state() private dps: string[] = [];
  @state() private result: PivotResult | null = null;
  @state() private loading = false;
  @state() private offline = false;
  @state() private manageOpen = false;

  private readonly store = new AuditConfigStore();
  private readonly api = this.resolveApi();
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
      ${this.manageOpen
        ? html`<at-manage-dialog
            @wui:change=${() => void this.onManageChange()}
            @wui:close=${() => (this.manageOpen = false)}
          ></at-manage-dialog>`
        : ''}
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.bootstrap();
  }

  private renderToolbar(): TemplateResult {
    const hasRows = (this.result?.rows.length ?? 0) > 0;
    return html`
      <div class="toolbar">
        <label class="inline">
          <span>Datapoint</span>
          <ix-select
            class="dp-select"
            mode="single"
            ?disabled=${this.dps.length === 0}
            .value=${this.config.dpName}
            @valueChange=${(e: CustomEvent<string | string[]>) => void this.patchConfig({ dpName: asString(e.detail) })}
          >
            ${this.dps.map((dp) => html`<ix-select-item label=${dp} value=${dp}></ix-select-item>`)}
          </ix-select>
        </label>
        <ix-button variant="secondary" @click=${() => (this.manageOpen = true)}>
          <ix-icon name="cogwheel" slot="icon"></ix-icon>Gérer
        </ix-button>
        ${this.renderRangeControls()}
        <span class="grow"></span>
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onExportCsv}>
          <ix-icon name="export" slot="icon"></ix-icon>CSV
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onExportJson}>
          <ix-icon name="export" slot="icon"></ix-icon>JSON
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onPrint}>
          <ix-icon name="print" slot="icon"></ix-icon>Imprimer
        </ix-button>
        <ix-button
          variant="secondary"
          ?disabled=${this.loading || this.config.dpName === ''}
          @click=${() => void this.recompute()}
        >
          <ix-icon name="refresh" slot="icon"></ix-icon>Actualiser
        </ix-button>
      </div>
    `;
  }

  private renderRangeControls(): TemplateResult {
    return html`
      <label class="inline live">
        <span>Live 24 h</span>
        <ix-toggle
          hide-text
          ?checked=${this.config.live}
          @checkedChange=${(e: CustomEvent<boolean>) => this.onLiveToggle(e.detail)}
        ></ix-toggle>
      </label>
      ${this.config.live
        ? ''
        : html`<span class="range">
            <input
              class="dt"
              type="datetime-local"
              .value=${this.config.rangeStart}
              @change=${(e: Event) => void this.patchConfig({ rangeStart: (e.target as HTMLInputElement).value })}
            />
            <span class="arrow">→</span>
            <input
              class="dt"
              type="datetime-local"
              .value=${this.config.rangeEnd}
              @change=${(e: Event) => void this.patchConfig({ rangeEnd: (e.target as HTMLInputElement).value })}
            />
          </span>`}
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
    if (this.dps.length === 0) {
      return html`<div class="center muted">
        Aucun datapoint <code>${AUDIT_DP_TYPE}</code>. Cliquez « Gérer » pour en créer un (archivé).
      </div>`;
    }
    if (this.config.dpName === '') {
      return html`<div class="center muted">Sélectionnez un datapoint d'audit trail.</div>`;
    }
    const rows = this.displayRows();
    if (rows.length === 0) {
      return html`<div class="center muted">
        Aucun enregistrement sur la période. Vérifiez que le datapoint est archivé (NGA).
      </div>`;
    }
    return this.renderTable(rows);
  }

  private renderTable(rows: string[][]): TemplateResult {
    return html`
      ${this.result?.truncated
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>Historique tronqué aux ${this.config.maxRows} enregistrements
            les plus récents.
          </div>`
        : ''}
      <div class="meta">
        <strong>${this.config.dpName}</strong> · ${rows.length} enregistrement(s) · ${this.rangeLabel()}
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              ${AUDIT_FIELDS.map((f) => html`<th class=${f.kind === 'time' ? 'sticky' : ''}>${f.label}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (cells) => html`<tr>
                ${cells.map(
                  (c, i) =>
                    html`<td class=${AUDIT_FIELDS[i].kind === 'time' ? 'sticky nowrap' : ''}>${c}</td>`
                )}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.config = await this.store.load();
    this.offline = this.store.offline;
    await this.reloadDps();
    await this.recompute();
  }

  /** Reload the `_AuditTrail` DP list and keep the selection valid. */
  private async reloadDps(): Promise<void> {
    this.dps = await listAuditDps(this.api);
    if (this.config.dpName !== '' && this.dps.includes(this.config.dpName)) return;
    const next = this.dps.includes(AUDIT_DP_TYPE) ? AUDIT_DP_TYPE : (this.dps[0] ?? '');
    if (next !== this.config.dpName) {
      this.config = { ...this.config, dpName: next };
      await this.store.save(this.config);
      this.offline = this.store.offline;
    }
  }

  /** Fixed `_AuditTrail` columns of the selected DP. */
  private columns(): AuditColumn[] {
    const dp = this.config.dpName;
    if (dp === '') return [];
    return AUDIT_FIELDS.map((f) => ({ dpe: `${dp}.${f.key}`, label: f.label }));
  }

  /** Result rows as formatted display cells, aligned to `AUDIT_FIELDS`. */
  private displayRows(): string[][] {
    const rows = this.result?.rows ?? [];
    return rows.map((row) =>
      AUDIT_FIELDS.map((f, i) => {
        const v = row.values[i];
        if (f.kind === 'time') return formatDateTime(toMsLoose(v) ?? row.t);
        return v == null ? '' : String(v);
      })
    );
  }

  private resolveRange(): { start: Date; end: Date } {
    const now = new Date();
    if (this.config.live) return { start: new Date(now.getTime() - LIVE_WINDOW_MS), end: now };
    const start = this.config.rangeStart ? new Date(this.config.rangeStart) : new Date(now.getTime() - LIVE_WINDOW_MS);
    let end = this.config.rangeEnd ? new Date(this.config.rangeEnd) : now;
    if (Number.isNaN(start.getTime())) return { start: new Date(now.getTime() - LIVE_WINDOW_MS), end: now };
    if (Number.isNaN(end.getTime())) end = now;
    return { start, end };
  }

  private rangeLabel(): string {
    const { start, end } = this.resolveRange();
    const range = `${formatDateTime(start.getTime())} → ${formatDateTime(end.getTime())}`;
    return this.config.live ? `${range} (live 24 h)` : range;
  }

  private async recompute(): Promise<void> {
    const cols = this.columns();
    if (this.config.dpName === '' || cols.length === 0) {
      this.result = null;
      this.connectLive([]);
      return;
    }
    this.loading = true;
    const { start, end } = this.resolveRange();
    this.result = await buildPivot(this.api, cols, start, end, this.config.maxRows);
    this.loading = false;
    this.connectLive(cols);
  }

  /** Live re-query (debounced) when any element changes — gated by live mode. */
  private connectLive(cols: AuditColumn[]): void {
    this.dpSub.unsubscribe();
    this.dpSub = new Subscription();
    const api = this.api;
    if (!api || !this.config.live || cols.length === 0) return;
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
    this.refreshDebounce = window.setTimeout(() => void this.recomputeSilent(), REFRESH_DEBOUNCE_MS);
  }

  private async recomputeSilent(): Promise<void> {
    const cols = this.columns();
    if (cols.length === 0) return;
    const { start, end } = this.resolveRange();
    this.result = await buildPivot(this.api, cols, start, end, this.config.maxRows);
  }

  // --- handlers --------------------------------------------------------------

  private async patchConfig(patch: Partial<AuditConfig>): Promise<void> {
    this.config = { ...this.config, ...patch };
    await this.store.save(this.config);
    this.offline = this.store.offline;
    await this.recompute();
  }

  private onLiveToggle(on: boolean): void {
    const patch: Partial<AuditConfig> = { live: on };
    if (!on && (this.config.rangeStart === '' || this.config.rangeEnd === '')) {
      const now = new Date();
      patch.rangeEnd = toLocalInput(now);
      patch.rangeStart = toLocalInput(new Date(now.getTime() - LIVE_WINDOW_MS));
    }
    void this.patchConfig(patch);
  }

  private async onManageChange(): Promise<void> {
    await this.reloadDps();
    await this.recompute();
  }

  private onExportCsv(): void {
    exportAuditCsv(this.config.dpName, this.displayRows());
  }

  private onExportJson(): void {
    exportAuditJson(this.config.dpName, this.displayRows());
  }

  private onPrint(): void {
    printAudit(this.config.dpName, this.rangeLabel(), this.displayRows());
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
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
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .grow {
      flex: 1;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .dp-select {
      min-width: 14rem;
    }
    .range {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .dt {
      font: inherit;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.25rem 0.4rem;
    }
    .arrow {
      color: var(--theme-color-soft-text);
    }
    .meta {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    code {
      font-family: monospace;
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
      text-align: center;
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
      max-width: 28rem;
      overflow: hidden;
      text-overflow: ellipsis;
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
  `;
}
