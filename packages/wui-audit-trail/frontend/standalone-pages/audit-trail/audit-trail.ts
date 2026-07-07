// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audit Trail — Standalone page (WinCC OA WebUI Runtime).
 *
 * GxP audit-trail viewer over the fixed `_AuditTrail` datapoint structure
 * (time / username / item / action / oldval → newval / reason / …). The page:
 *   • lists the project's `_AuditTrail` datapoints and shows the archived (NGA)
 *     history of the selected one as a log table (one row per archived record);
 *   • defaults to the rolling last 24 h in live mode (auto-refresh) and offers a
 *     start/end datetime range for an arbitrary interval;
 *   • filters the log client-side: a global search across all columns, a text
 *     filter per column, and click-to-sort headers (asc → desc → default order).
 *     This view state is transient (NOT persisted to `AuditTrail_Config`);
 *   • exports the displayed log to CSV / JSON and prints it (WYSIWYG: exports
 *     reflect the current search/filters/sort);
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
import { hasRole$, registerModuleRoles } from './_vendor/wui-kit/data/app-security.js';
import './audit-trail/at-manage-dialog.js';
import { AuditConfigStore } from './audit-trail/config-store.js';
import { listAuditDps } from './audit-trail/dp-admin.js';
import { auditColumns, buildMergedPivot, type PivotResult } from './audit-trail/engine.js';
import { exportAuditCsv, exportAuditJson, printAudit } from './audit-trail/export.js';
import { MSG, colLabel, liveSuffixMsg, localize, localizeDir, ml, recordsMsg, shownOfMsg, truncatedMsg } from './audit-trail/i18n.js';
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
/** Application-Security module id (= the page id). */
const MODULE_ID = 'audit-trail';
/** Page title — a proper noun, identical in all three languages. */
const PAGE_TITLE = 'Audit Trail';

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

function asStrings(detail: string | string[]): string[] {
  if (Array.isArray(detail)) return detail.filter((s) => s !== '');
  return detail === '' ? [] : [detail];
}

/** One display column (a `columnKeys()` entry). */
interface ColumnKey {
  key: string;
  kind?: 'time';
}

/** Transient column sort — header clicks cycle asc → desc → none (engine order). */
interface ColumnSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** A display row paired with its sortable record timestamp (epoch ms). */
interface ViewRow {
  cells: string[];
  t: number;
}

/** Locale/numeric-aware cell comparison (`"9" < "10"`, accents folded). */
function compareCells(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** `aria-sort` value for a header cell. */
function ariaSortValue(dir: ColumnSort['dir'] | null): 'ascending' | 'descending' | 'none' {
  if (dir === 'asc') return 'ascending';
  if (dir === 'desc') return 'descending';
  return 'none';
}

/** Header sort indicator glyph. */
function sortGlyph(dir: ColumnSort['dir'] | null): string {
  if (dir === 'asc') return '▲';
  if (dir === 'desc') return '▼';
  return '';
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

  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private roleView = true;

  /** Application-Security grant for the 'manage' role (open until assigned). */
  @state() private roleManage = true;

  /** Global search across all columns (transient — not persisted). */
  @state() private search = '';

  /** Per-column substring filters, keyed by column key (transient — not persisted). */
  @state() private colFilters: Record<string, string> = {};

  /** Active column sort, `null` = engine order (newest first). Transient. */
  @state() private sort: ColumnSort | null = null;

  private readonly store = new AuditConfigStore();
  private readonly api = this.resolveApi();
  private dpSub = new Subscription();
  private roleSub = new Subscription();
  private refreshDebounce = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles({
      module: MODULE_ID,
      title: ml(PAGE_TITLE, PAGE_TITLE, PAGE_TITLE),
      roles: [
        { id: 'view', label: ml('View', 'Consulter', 'Ansehen') },
        { id: 'manage', label: ml('Manage audit DPs', 'Gérer les DP d’audit', 'Audit-DPs verwalten') }
      ]
    });
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.roleView = granted));
    this.roleSub.add(
      hasRole$(MODULE_ID, 'manage').subscribe((granted) => {
        this.roleManage = granted;
        if (!granted) this.manageOpen = false; // close a manage dialog opened before the revoke
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dpSub.unsubscribe();
    this.roleSub.unsubscribe();
    window.clearTimeout(this.refreshDebounce);
  }

  override render(): TemplateResult {
    const title = PAGE_TITLE;
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': title, 'fr.utf8': title, 'de.utf8': title }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.roleView
          ? html`${this.renderToolbar()} ${this.renderOffline()} ${this.renderContent()}`
          : html`<div class="center muted">${localizeDir(MSG.content.roleForbidden)}</div>`}
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
          <span>${localizeDir(MSG.toolbar.datapoint)}</span>
          <ix-select
            class="dp-select"
            mode="multiple"
            allow-clear
            i18n-placeholder=${localize(MSG.toolbar.datapointPlaceholder)}
            ?disabled=${this.dps.length === 0}
            .value=${this.config.dpNames}
            @valueChange=${(e: CustomEvent<string | string[]>) => this.onDpsChange(asStrings(e.detail))}
          >
            ${this.dps.map((dp) => html`<ix-select-item label=${dp} value=${dp}></ix-select-item>`)}
          </ix-select>
        </label>
        ${this.roleManage
          ? html`<ix-button variant="secondary" @click=${() => (this.manageOpen = true)}>
              <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.manage)}
            </ix-button>`
          : ''}
        ${this.renderRangeControls()}
        <span class="grow"></span>
        ${this.renderSearch(hasRows)}
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onExportCsv}>
          <ix-icon name="export" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.csv)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onExportJson}>
          <ix-icon name="export" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.json)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!hasRows} @click=${this.onPrint}>
          <ix-icon name="print" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.print)}
        </ix-button>
        <ix-button
          variant="secondary"
          ?disabled=${this.loading || this.config.dpNames.length === 0}
          @click=${() => void this.recompute()}
        >
          <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.refresh)}
        </ix-button>
      </div>
    `;
  }

  /** Global search input — filters the displayed rows across ALL columns. */
  private renderSearch(hasRows: boolean): TemplateResult {
    return html`<input
      class="dt search"
      type="search"
      placeholder=${localize(MSG.toolbar.search)}
      ?disabled=${!hasRows && this.search === ''}
      .value=${this.search}
      @input=${(e: Event) => (this.search = (e.target as HTMLInputElement).value)}
    />`;
  }

  private renderRangeControls(): TemplateResult {
    return html`
      <label class="inline live">
        <span>${localizeDir(MSG.toolbar.live24h)}</span>
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
      <ix-icon name="info"></ix-icon>${localizeDir(MSG.notice.offline)}
    </div>`;
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    if (this.dps.length === 0) {
      return html`<div class="center muted">
        ${localizeDir(MSG.content.noDpsPrefix)} <code>${AUDIT_DP_TYPE}</code>${localizeDir(MSG.content.noDpsSuffix)}
      </div>`;
    }
    if (this.config.dpNames.length === 0) {
      return html`<div class="center muted">${localizeDir(MSG.content.selectDp)}</div>`;
    }
    const total = this.result?.rows.length ?? 0;
    if (total === 0) {
      return html`<div class="center muted">
        ${localizeDir(MSG.content.noRecords)}
      </div>`;
    }
    return this.renderTable(this.visibleRows(), total);
  }

  /** Column keys in display order — a leading `source` column when several DPs are merged. */
  private columnKeys(): ColumnKey[] {
    const fields = AUDIT_FIELDS.map((f) => ({ key: f.key, kind: f.kind }));
    return this.isMulti() ? [{ key: 'source' }, ...fields] : fields;
  }

  private renderTable(rows: string[][], total: number): TemplateResult {
    const cols = this.columnKeys();
    return html`
      ${this.result?.truncated
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>${truncatedMsg(this.config.maxRows)}
          </div>`
        : ''}
      <div class="meta">
        <strong>${this.config.dpNames.join(' + ')}</strong> ·
        ${rows.length === total ? recordsMsg(total) : shownOfMsg(rows.length, total)} · ${this.rangeLabel()}
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              ${cols.map((f) => this.renderHeaderCell(f))}
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr>
                  <td class="no-match" colspan=${cols.length}>${localizeDir(MSG.content.noMatch)}</td>
                </tr>`
              : rows.map(
                  (cells) => html`<tr>
                    ${cells.map(
                      (c, i) =>
                        html`<td class=${cols[i]?.kind === 'time' ? 'sticky nowrap' : ''}>${c}</td>`
                    )}
                  </tr>`
                )}
          </tbody>
        </table>
      </div>
    `;
  }

  /** Sortable header cell: click-to-sort label + per-column filter input. */
  private renderHeaderCell(col: ColumnKey): TemplateResult {
    const dir = this.sort?.key === col.key ? this.sort.dir : null;
    return html`<th class=${col.kind === 'time' ? 'sticky' : ''} aria-sort=${ariaSortValue(dir)}>
      <button class="th-sort" title=${localize(MSG.table.sortHint)} @click=${() => this.onSort(col.key)}>
        ${localizeDir(colLabel(col.key as keyof typeof MSG.col))}
        <span class="sort-ind">${sortGlyph(dir)}</span>
      </button>
      <input
        class="th-filter"
        type="search"
        placeholder=${localize(MSG.table.filterPlaceholder)}
        .value=${this.colFilters[col.key] ?? ''}
        @input=${(e: Event) => this.onColFilter(col.key, (e.target as HTMLInputElement).value)}
      />
    </th>`;
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.config = await this.store.load();
    // Migration: configs saved by the single-DP bundle only carry `dpName`.
    if (this.config.dpNames.length === 0 && this.config.dpName !== '') {
      this.config = { ...this.config, dpNames: [this.config.dpName] };
    }
    this.offline = this.store.offline;
    await this.reloadDps();
    await this.recompute();
  }

  /** True when several DPs are merged (adds the source column). */
  private isMulti(): boolean {
    return this.config.dpNames.length > 1;
  }

  /** Reload the `_AuditTrail` DP list and keep the selection valid. */
  private async reloadDps(): Promise<void> {
    this.dps = await listAuditDps(this.api);
    const valid = this.config.dpNames.filter((dp) => this.dps.includes(dp));
    const next = valid.length > 0 ? valid : [this.dps.includes(AUDIT_DP_TYPE) ? AUDIT_DP_TYPE : (this.dps[0] ?? '')].filter((s) => s !== '');
    if (next.join('|') !== this.config.dpNames.join('|')) {
      this.config = { ...this.config, dpNames: next, dpName: next[0] ?? '' };
      await this.store.save(this.config);
      this.offline = this.store.offline;
    }
  }

  /** Live-connected leaves: the fixed columns of EVERY selected DP. */
  private columns(): AuditColumn[] {
    return this.config.dpNames.flatMap((dp) => auditColumns(dp));
  }

  /** Result rows as formatted display cells, aligned to {@link columnKeys}. */
  private displayRows(): string[][] {
    const rows = this.result?.rows ?? [];
    const multi = this.isMulti();
    return rows.map((row) => {
      const cells = AUDIT_FIELDS.map((f, i) => {
        const v = row.values[i];
        if (f.kind === 'time') return formatDateTime(toMsLoose(v) ?? row.t);
        return v == null ? '' : String(v);
      });
      return multi ? [row.source ?? '', ...cells] : cells;
    });
  }

  /**
   * Display rows after the global search, per-column filters and column sort —
   * what the table shows AND what CSV/JSON/print get (WYSIWYG).
   */
  private visibleRows(): string[][] {
    const cols = this.columnKeys();
    return this.sortRows(cols, this.filterRows(cols, this.pairedRows())).map((r) => r.cells);
  }

  /**
   * Display rows paired with the record's sortable timestamp — same value as
   * the rendered `time` cell (a dd/mm/yyyy string, whose string order would be
   * wrong): the record's own `time`, falling back to the archive change time.
   */
  private pairedRows(): ViewRow[] {
    const raw = this.result?.rows ?? [];
    const timeIdx = AUDIT_FIELDS.findIndex((f) => f.kind === 'time');
    return this.displayRows().map((cells, i) => ({
      cells,
      t: toMsLoose(raw[i]?.values[timeIdx]) ?? raw[i]?.t ?? 0
    }));
  }

  /** Case-insensitive substring match: global search first, then per-column filters. */
  private filterRows(cols: ColumnKey[], rows: ViewRow[]): ViewRow[] {
    let out = rows;
    const q = this.search.trim().toLowerCase();
    if (q !== '') {
      out = out.filter((r) => r.cells.some((c) => c.toLowerCase().includes(q)));
    }
    for (const [key, value] of Object.entries(this.colFilters)) {
      const f = value.trim().toLowerCase();
      if (f === '') continue;
      const i = cols.findIndex((c) => c.key === key);
      if (i === -1) continue; // e.g. a `source` filter while a single DP is selected
      out = out.filter((r) => (r.cells[i] ?? '').toLowerCase().includes(f));
    }
    return out;
  }

  /** Applies {@link sort}; `null` (or an absent column) keeps the engine order. */
  private sortRows(cols: ColumnKey[], rows: ViewRow[]): ViewRow[] {
    const sort = this.sort;
    if (sort === null) return rows;
    const i = cols.findIndex((c) => c.key === sort.key);
    if (i === -1) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const byTime = cols[i]?.kind === 'time';
    return [...rows].sort(
      (a, b) => dir * (byTime ? a.t - b.t : compareCells(a.cells[i] ?? '', b.cells[i] ?? ''))
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
    return this.config.live ? `${range} ${liveSuffixMsg()}` : range;
  }

  private async recompute(): Promise<void> {
    const cols = this.columns();
    if (this.config.dpNames.length === 0) {
      this.result = null;
      this.connectLive([]);
      return;
    }
    this.loading = true;
    const { start, end } = this.resolveRange();
    this.result = await buildMergedPivot(this.api, this.config.dpNames, start, end, this.config.maxRows);
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
    if (this.config.dpNames.length === 0) return;
    const { start, end } = this.resolveRange();
    this.result = await buildMergedPivot(this.api, this.config.dpNames, start, end, this.config.maxRows);
  }

  // --- handlers --------------------------------------------------------------

  private async patchConfig(patch: Partial<AuditConfig>): Promise<void> {
    this.config = { ...this.config, ...patch };
    await this.store.save(this.config);
    this.offline = this.store.offline;
    await this.recompute();
  }

  private onDpsChange(dpNames: string[]): void {
    // `dpName` mirrors the first selection for configs read by older bundles.
    void this.patchConfig({ dpNames, dpName: dpNames[0] ?? '' });
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

  /** Header click: asc → desc → back to the default order (newest first). */
  private onSort(key: string): void {
    if (this.sort?.key !== key) {
      this.sort = { key, dir: 'asc' };
      return;
    }
    this.sort = this.sort.dir === 'asc' ? { key, dir: 'desc' } : null;
  }

  private onColFilter(key: string, value: string): void {
    this.colFilters = { ...this.colFilters, [key]: value };
  }

  private onExportCsv(): void {
    exportAuditCsv(this.config.dpNames.join('+'), this.visibleRows(), this.isMulti());
  }

  private onExportJson(): void {
    exportAuditJson(this.config.dpNames.join('+'), this.visibleRows(), this.isMulti());
  }

  private onPrint(): void {
    printAudit(this.config.dpNames.join(' + '), this.rangeLabel(), this.visibleRows(), this.isMulti());
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
    .search {
      min-width: 13rem;
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
      vertical-align: top;
    }
    .th-sort {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      width: 100%;
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      font-weight: 600;
      color: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .sort-ind {
      min-width: 0.8rem;
      font-size: 0.6rem;
      color: var(--theme-color-primary);
    }
    .th-filter {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-width: 5.5rem;
      margin-top: 0.25rem;
      font: inherit;
      font-size: 0.75rem;
      font-weight: 400;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.1rem 0.3rem;
    }
    .no-match {
      text-align: center;
      color: var(--theme-color-soft-text);
      padding: 1.5rem 1rem;
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
