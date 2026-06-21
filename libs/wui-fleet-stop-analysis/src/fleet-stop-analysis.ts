/**
 * Fleet Stop-Cause Analysis — Standalone page (WinCC OA WebUI Runtime).
 *
 * Reached from the Machine Fleet 3D overview ("Analyse des causes d'arrêts").
 * Decomposes machine downtime by stop cause across multiple machines over a
 * configurable period (default: last month), with filters per atelier and per
 * machine (multi-select), a sort selector, and two views (table + stacked bar
 * chart). The heavy lifting — querying the archived state/cause histories and
 * cross-referencing non-production intervals with assigned causes — lives in
 * {@link analyseStopCauses}.
 *
 * Registered at `/fleet-stops` (component `wui-fleet-stop-analysis`). Reuses the
 * Machine Fleet 3D {@link FleetStore} for atelier configs and the stop-cause
 * catalog. `echarts` is resolved via the shared-bundle import map (externalised
 * by `build:pages`, like the rest of the app).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { pageStyles } from '@visuelconcept/wui-fleet-core/styles.js';
import { FleetStore } from '@visuelconcept/wui-fleet-core/data/fleet-store.js';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import '@visuelconcept/wui-fleet-core/ui/mf-stop-causes.js';
import {
  STOP_CLASSIFICATION_LABELS,
  type Atelier,
  type StopCause,
  type StopClassification
} from '@visuelconcept/wui-fleet-core/types.js';
import {
  analyseStopCauses,
  collectMachines,
  formatDuration,
  sortRows,
  toHours,
  type AnalysisResult,
  type CauseRow,
  type RawStop,
  type SortKey
} from '@visuelconcept/wui-fleet-core/engine.js';
import {
  buildNonWorkedMap,
  emptyClosureConfig,
  normaliseClosures,
  type ClosureConfig
} from '@visuelconcept/wui-fleet-core/closures.js';

const TAB_TABLE = 0;
const TAB_CHART = 1;
const TAB_RAW = 2;
const DEBOUNCE_MS = 300;
const DATE_FORMAT = 'yyyy-MM-dd';
const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;

const SORT_LABELS: Record<SortKey, string> = {
  assigned: 'Cumul de temps assigné',
  downtime: "Temps d'arrêt total",
  occurrences: "Nombre d'occurrences"
};

/** Bar colour per machine series (cycled). */
const SERIES_COLORS = [
  '#00cccc', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#ec4899', '#84cc16', '#f97316', '#14b8a6'
];

/** Sortable columns of the raw-data table. */
type RawSortCol = 'machine' | 'cause' | 'category' | 'start' | 'end' | 'duration' | 'counted';
type SortDir = 'asc' | 'desc';

/** Time-category (classification) filter: a classification or "all". */
type ClassFilter = StopClassification | 'all';
const CLASS_OPTIONS: { value: ClassFilter; label: string }[] = [
  { value: 'unplanned', label: 'Non planifié' },
  { value: 'planned', label: 'Planifié' },
  { value: 'all', label: 'Toutes catégories' }
];

/** Default number of causes (bars) shown in the chart. */
const DEFAULT_CHART_TOP = 5;
/** Chart "Top N causes" options (value `0` = all). */
const TOP_OPTIONS: { value: string; label: string }[] = [
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '0', label: 'Toutes les causes' }
];

/** Coerce an ix-select value (string | string[]) to a string array. */
function toList(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** Format a ms-epoch timestamp as a French date+time (e.g. "08/06/2026 14:32"). */
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

@customElement('wui-fleet-stop-analysis')
export class WuiFleetStopAnalysis extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private ateliers: Atelier[] = [];
  @state() private catalog: StopCause[] = [];
  @state() private selectedAteliers: string[] = [];
  @state() private selectedMachines: string[] = [];
  @state() private startStr = '';
  @state() private endStr = '';
  @state() private sortKey: SortKey = 'assigned';
  @state() private classFilter: ClassFilter = 'unplanned';
  @state() private chartTop = DEFAULT_CHART_TOP;
  @state() private machineSearch = '';
  @state() private rawSortCol: RawSortCol = 'start';
  @state() private rawSortDir: SortDir = 'desc';
  @state() private tab = TAB_TABLE;
  @state() private result: AnalysisResult | null = null;
  @state() private loading = false;
  @state() private offline = false;
  /** Non-worked periods, loaded to exclude their downtime from the cause totals. */
  @state() private closures: ClosureConfig = emptyClosureConfig();
  /** Stop-cause catalog editor open state. */
  @state() private stopCausesOpen = false;
  /** Edit permission (canPublish); when false the catalog editor is view-only. */
  @state() private canEdit = canEditFleet();

  private readonly store = new FleetStore();
  private readonly api = this.resolveApi();
  private debounceId = 0;
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private permSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.initDefaultRange();
    this.permSub = canEditFleet$().subscribe((allowed) => (this.canEdit = allowed));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.debounceId) window.clearTimeout(this.debounceId);
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
    this.permSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': 'Stop-Cause Analysis', 'fr.utf8': "Analyse des causes d'arrêts" }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.renderToolbar()} ${this.renderOffline()} ${this.renderTabs()} ${this.renderContent()}
      </div>
      ${this.stopCausesOpen
        ? html`<mf-stop-causes
            .store=${this.store}
            .canEdit=${this.canEdit}
            @wui:close=${this.onStopCausesClose}
          ></mf-stop-causes>`
        : ''}
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.bootstrap();
  }

  protected override updated(_changed: PropertyValues): void {
    if (this.tab === TAB_CHART) this.renderChart();
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" outline @click=${this.back}>
          <ix-icon name="arrow-left" slot="icon"></ix-icon>Retour
        </ix-button>
        <ix-button variant="secondary" @click=${() => (this.stopCausesOpen = true)}>
          <ix-icon name="alarm" slot="icon"></ix-icon>Causes d'arrêt
        </ix-button>
        <span class="sep"></span>
        ${this.renderDateField('Début', this.startStr, 'start')}
        ${this.renderDateField('Fin', this.endStr, 'end')} ${this.renderAtelierField()}
        ${this.renderMachineField()} ${this.renderClassField()} ${this.renderSortField()}
        <span class="grow"></span>
        <ix-button @click=${() => void this.recompute()} ?disabled=${this.loading}>
          <ix-icon name="refresh" slot="icon"></ix-icon>Actualiser
        </ix-button>
      </div>
    `;
  }

  private renderDateField(label: string, value: string, which: 'start' | 'end'): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">${label}</span>
        <ix-date-input
          format=${DATE_FORMAT}
          .value=${value}
          @valueChange=${(e: CustomEvent<string>) => this.onDate(which, e.detail)}
        ></ix-date-input>
      </label>
    `;
  }

  private renderAtelierField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Ateliers</span>
        <ix-select
          mode="multiple"
          allow-clear
          i18n-placeholder="Tous les ateliers"
          .value=${this.selectedAteliers}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onSelect('ateliers', e.detail)}
        >
          ${this.ateliers.map(
            (a) => html`<ix-select-item value=${a.id} label=${a.name}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderMachineField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Machines</span>
        <ix-select
          mode="multiple"
          allow-clear
          i18n-placeholder="Toutes les machines"
          .value=${this.selectedMachines}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onSelect('machines', e.detail)}
        >
          ${this.machineOptions().map(
            (m) => html`<ix-select-item value=${m.id} label=${m.label}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderSortField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Trier par</span>
        <ix-select
          .value=${this.sortKey}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onSort(e.detail)}
        >
          ${(Object.keys(SORT_LABELS) as SortKey[]).map(
            (k) => html`<ix-select-item value=${k} label=${SORT_LABELS[k]}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderClassField(): TemplateResult {
    return html`
      <label class="field">
        <span class="lbl">Catégorie de temps</span>
        <ix-select
          .value=${this.classFilter}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onClassFilter(e.detail)}
        >
          ${CLASS_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderOffline(): TemplateResult {
    if (!this.offline) return html``;
    return html`<div class="notice">
      <ix-icon name="info"></ix-icon>Mode hors-ligne : configuration des ateliers indisponible
      (backend non connecté). Les données d'historique ne peuvent pas être lues.
    </div>`;
  }

  private renderTabs(): TemplateResult {
    return html`
      <ix-tabs .selected=${this.tab} @selectedChange=${(e: CustomEvent<number>) => (this.tab = e.detail)}>
        <ix-tab-item>Tableau</ix-tab-item>
        <ix-tab-item>Graphique</ix-tab-item>
        <ix-tab-item>Données brutes</ix-tab-item>
      </ix-tabs>
    `;
  }

  private renderContent(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const result = this.result;
    if (!result) return html``;
    if (result.queriedMachineCount === 0) {
      return html`<div class="center muted">
        Aucune machine sélectionnée n'a de datapoint d'état et de cause d'arrêt configurés.
      </div>`;
    }
    if (result.noHistory) {
      return html`<div class="center muted">
        Aucune donnée d'historique sur la période. Vérifiez que les datapoints d'état et de cause
        sont archivés (configuration d'archivage NGA).
      </div>`;
    }
    if (result.rows.length === 0) {
      return html`<div class="center muted">Aucun arrêt sur la période sélectionnée.</div>`;
    }
    if (this.visibleRows().length === 0) {
      return html`<div class="center muted">
        Aucune cause dans cette catégorie de temps sur la période.
      </div>`;
    }
    if (this.tab === TAB_CHART) return this.renderChartHost();
    if (this.tab === TAB_RAW) return this.renderRawTable();
    return this.renderTable();
  }

  /** Result rows after the time-category (classification) filter. */
  private visibleRows(): CauseRow[] {
    const rows = this.result?.rows ?? [];
    if (this.classFilter === 'all') return rows;
    return rows.filter((r) => r.classification === this.classFilter);
  }

  private renderTable(): TemplateResult {
    const rows = sortRows(this.visibleRows(), this.sortKey);
    const totalAssigned = rows.reduce((s, r) => s + r.assignedMs, 0);
    const totalDowntime = rows.reduce((s, r) => s + r.downtimeMs, 0);
    const totalOcc = rows.reduce((s, r) => s + r.occurrences, 0);
    return html`
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Cause</th>
              <th>Classification</th>
              ${this.aggHeader('Temps assigné', 'assigned')}
              ${this.aggHeader("Temps d'arrêt total", 'downtime')}
              ${this.aggHeader('Occurrences', 'occurrences')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => this.renderRow(r, totalAssigned))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td></td>
              <td class="num">${formatDuration(totalAssigned)}</td>
              <td class="num">${formatDuration(totalDowntime)}</td>
              <td class="num">${totalOcc}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  private aggHeader(label: string, key: SortKey): TemplateResult {
    const arrow = this.sortKey === key ? ' ▼' : '';
    return html`<th class="sortable num" @click=${() => (this.sortKey = key)}>${label}${arrow}</th>`;
  }

  private renderRow(r: CauseRow, totalAssigned: number): TemplateResult {
    const pct = totalAssigned > 0 ? Math.round((r.assignedMs / totalAssigned) * 100) : 0;
    return html`
      <tr>
        <td>${r.label}</td>
        <td>${this.renderClassification(r.classification)}</td>
        <td class="num">
          <div class="bar-cell">
            <span class="bar" style="--p:${pct}%"></span>
            <span>${formatDuration(r.assignedMs)} <em>(${pct} %)</em></span>
          </div>
        </td>
        <td class="num">${formatDuration(r.downtimeMs)}</td>
        <td class="num">${r.occurrences}</td>
      </tr>
    `;
  }

  private renderClassification(c: StopClassification | undefined): TemplateResult {
    if (!c) return html`<span class="muted">—</span>`;
    return html`<span class="chip chip--${c}">${STOP_CLASSIFICATION_LABELS[c]}</span>`;
  }

  /** Raw stop records after the classification filter, machine search and sort. */
  private visibleRawStops(): RawStop[] {
    let raw = this.result?.rawStops ?? [];
    if (this.classFilter !== 'all') raw = raw.filter((r) => r.classification === this.classFilter);
    const q = this.machineSearch.trim().toLowerCase();
    if (q) raw = raw.filter((r) => r.machineName.toLowerCase().includes(q));
    return this.sortRawStops(raw);
  }

  private sortRawStops(rows: RawStop[]): RawStop[] {
    const dir = this.rawSortDir === 'asc' ? 1 : -1;
    const col = this.rawSortCol;
    const cmp = (a: RawStop, b: RawStop): number => {
      if (col === 'machine') return a.machineName.localeCompare(b.machineName);
      if (col === 'cause') return a.causeLabel.localeCompare(b.causeLabel);
      if (col === 'category') return (a.classification ?? '').localeCompare(b.classification ?? '');
      if (col === 'end') return a.endMs - b.endMs;
      if (col === 'duration') return a.durationMs - b.durationMs;
      if (col === 'counted') return a.countedMs - b.countedMs;
      return a.startMs - b.startMs;
    };
    return [...rows].sort((a, b) => dir * cmp(a, b));
  }

  private renderRawTable(): TemplateResult {
    const rows = this.visibleRawStops();
    const multiAtelier = this.ateliers.length > 1;
    return html`
      <div class="raw-area">
        <div class="raw-tools">
          <ix-input
            class="raw-search"
            placeholder="Rechercher une machine…"
            .value=${this.machineSearch}
            @valueChange=${(e: CustomEvent<string>) => (this.machineSearch = String(e.detail))}
          ></ix-input>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                ${this.rawHeader('Machine', 'machine')} ${this.rawHeader('Cause', 'cause')}
                ${this.rawHeader('Catégorie', 'category')} ${this.rawHeader('Début', 'start')}
                ${this.rawHeader('Fin', 'end')} ${this.rawHeader('Durée', 'duration', true)}
                ${this.rawHeader('Temps comptabilisé', 'counted', true)}
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td>${multiAtelier ? `${r.machineName} · ${r.atelierName}` : r.machineName}</td>
                  <td>${r.causeLabel}</td>
                  <td>${this.renderClassification(r.classification)}</td>
                  <td class="nowrap">${formatDateTime(r.startMs)}</td>
                  <td class="nowrap">${formatDateTime(r.endMs)}</td>
                  <td class="num">${formatDuration(r.durationMs)}</td>
                  <td class="num" title=${r.countedMs < r.durationMs ? 'Réduit par une période non travaillée' : ''}>
                    ${formatDuration(r.countedMs)}${r.countedMs < r.durationMs
                      ? html` <ix-icon name="calendar" size="12"></ix-icon>`
                      : ''}
                  </td>
                </tr>`
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5">${rows.length} arrêt(s)</td>
                <td class="num">${formatDuration(rows.reduce((s, r) => s + r.durationMs, 0))}</td>
                <td class="num">${formatDuration(rows.reduce((s, r) => s + r.countedMs, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  private rawHeader(label: string, col: RawSortCol, num = false): TemplateResult {
    const active = this.rawSortCol === col;
    const arrow = active ? (this.rawSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return html`<th
      class="sortable ${num ? 'num' : ''}"
      @click=${() => this.onRawSort(col)}
    >${label}${arrow}</th>`;
  }

  private onRawSort(col: RawSortCol): void {
    if (this.rawSortCol === col) {
      this.rawSortDir = this.rawSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.rawSortCol = col;
      // Times/duration default to descending (recent/longest first); text ascending.
      const descCols: RawSortCol[] = ['start', 'end', 'duration', 'counted'];
      this.rawSortDir = descCols.includes(col) ? 'desc' : 'asc';
    }
  }

  private renderChartHost(): TemplateResult {
    return html`
      <div class="chart-area">
        <div class="chart-tools">
          <label class="field field--inline">
            <span class="lbl">Afficher</span>
            <ix-select
              .value=${String(this.chartTop)}
              @valueChange=${(e: CustomEvent<string | string[]>) => this.onChartTop(e.detail)}
            >
              ${TOP_OPTIONS.map(
                (o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`
              )}
            </ix-select>
          </label>
        </div>
        <div class="chart" id="chart"></div>
      </div>
    `;
  }

  private renderChart(): void {
    const host = this.renderRoot.querySelector<HTMLElement>('#chart');
    const result = this.result;
    if (!host || !result || result.rows.length === 0) return;
    // Lit recreates the host div when the tab toggles; rebind echarts if the
    // existing instance points at a now-detached node.
    if (this.chart && this.chart.getDom() !== host) {
      this.resizeObserver?.disconnect();
      this.chart.dispose();
      this.chart = null;
    }
    if (!this.chart) {
      this.chart = echarts.init(host);
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(host);
    }
    this.chart.setOption(this.chartOption(result), true);
  }

  private chartOption(result: AnalysisResult): echarts.EChartsCoreOption {
    const sorted = sortRows(this.visibleRows(), this.sortKey);
    const rows = this.chartTop > 0 ? sorted.slice(0, this.chartTop) : sorted;
    const text = this.cssVar('--theme-color-std-text', '#e8e8e8');
    const series = result.machines.map((m, i) => ({
      name: m.name,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
      itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
      data: rows.map((r) => toHours(r.perMachine.get(m.id) ?? 0))
    }));
    return {
      backgroundColor: 'transparent',
      textStyle: { color: text },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: unknown) => `${Number(v).toLocaleString('fr-FR')} h`
      },
      legend: { textStyle: { color: text }, type: 'scroll', top: 0 },
      grid: { left: 8, right: 24, bottom: 8, top: 48, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.label),
        axisLabel: { color: text, interval: 0, rotate: rows.length > 6 ? 30 : 0 }
      },
      yAxis: {
        type: 'value',
        name: 'Heures',
        nameTextStyle: { color: text },
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: this.cssVar('--theme-color-soft-bdr', '#444') } }
      },
      series
    };
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.store.listAteliers();
    this.catalog = await this.store.listStopCauses();
    this.closures = normaliseClosures(await this.store.listClosures());
    this.offline = this.store.offline;
    this.applyHandoffFilter();
    await this.recompute();
  }

  /** Pre-filter from a hand-off (e.g. the machine dashboard's "Analyser" button):
   * either the URL hash query (`#/fleet-stops?atelier=..&machine=..`, used when
   * opened in a new tab) or a `{atelierId, machineId}` stashed in sessionStorage. */
  private applyHandoffFilter(): void {
    const hash = window.location.hash;
    const qi = hash.indexOf('?');
    if (qi !== -1) {
      const params = new URLSearchParams(hash.slice(qi + 1));
      const atelier = params.get('atelier');
      const machine = params.get('machine');
      if (atelier) this.selectedAteliers = [atelier];
      if (machine) this.selectedMachines = [machine];
      if (atelier || machine) return;
    }
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('mf-stop-analysis-filter');
      sessionStorage.removeItem('mf-stop-analysis-filter');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const f = JSON.parse(raw) as { atelierId?: string; machineId?: string };
      if (f.atelierId) this.selectedAteliers = [f.atelierId];
      if (f.machineId) this.selectedMachines = [f.machineId];
    } catch {
      // Malformed hand-off — ignore and show the unfiltered analysis.
    }
  }

  private async recompute(): Promise<void> {
    const start = this.parseDate(this.startStr, false);
    const parsedEnd = this.parseDate(this.endStr, true);
    // Never analyse into the future: clamp the end to "now". Otherwise a machine
    // currently stopped has its open interval extended to the end-of-day boundary,
    // inflating durations (by up to a day) and giving different totals per reload.
    const now = new Date();
    const end = parsedEnd && parsedEnd > now ? now : parsedEnd;
    if (!start || !end || start >= end) {
      this.loading = false;
      return;
    }
    this.loading = true;
    const machines = collectMachines(
      this.ateliers,
      new Set(this.selectedAteliers),
      new Set(this.selectedMachines)
    );
    const nonWorked = buildNonWorkedMap(this.closures, machines);
    this.result = await analyseStopCauses(this.api, machines, this.catalog, start, end, nonWorked);
    this.loading = false;
  }

  private machineOptions(): { id: string; label: string }[] {
    const selected = new Set(this.selectedAteliers);
    const out: { id: string; label: string }[] = [];
    for (const a of this.ateliers) {
      if (selected.size > 0 && !selected.has(a.id)) continue;
      for (const m of a.machines) {
        if (!m.stateDp || !m.stopCauseDp) continue;
        out.push({ id: m.id, label: this.ateliers.length > 1 ? `${m.name} · ${a.name}` : m.name });
      }
    }
    return out;
  }

  private initDefaultRange(): void {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    this.endStr = this.toDateStr(now);
    this.startStr = this.toDateStr(start);
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private parseDate(str: string, endOfDay: boolean): Date | null {
    if (!str) return null;
    const d = new Date(`${str}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return endOfDay ? new Date(d.getTime() + END_OF_DAY_MS) : d;
  }

  private toDateStr(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }

  private scheduleRecompute(): void {
    if (this.debounceId) window.clearTimeout(this.debounceId);
    this.debounceId = window.setTimeout(() => void this.recompute(), DEBOUNCE_MS);
  }

  private readonly back = (): void => {
    this.dispatchEvent(new RouterEvent('/fleet-3d'));
  };

  /** Editing the catalog can change classifications/labels → reload and recompute. */
  private readonly onStopCausesClose = (): void => {
    this.stopCausesOpen = false;
    void this.reloadCatalog();
  };

  private async reloadCatalog(): Promise<void> {
    this.catalog = await this.store.listStopCauses();
    await this.recompute();
  }

  private readonly onDate = (which: 'start' | 'end', value: string): void => {
    if (which === 'start') this.startStr = value;
    else this.endStr = value;
    this.scheduleRecompute();
  };

  private readonly onSelect = (which: 'ateliers' | 'machines', value: string | string[]): void => {
    const list = toList(value);
    if (which === 'ateliers') {
      this.selectedAteliers = list;
      // Drop machine selections no longer offered by the atelier filter.
      const offered = new Set(this.machineOptions().map((m) => m.id));
      this.selectedMachines = this.selectedMachines.filter((id) => offered.has(id));
    } else {
      this.selectedMachines = list;
    }
    this.scheduleRecompute();
  };

  private readonly onSort = (value: string | string[]): void => {
    const key = (Array.isArray(value) ? value[0] : value) as SortKey;
    if (key in SORT_LABELS) this.sortKey = key;
  };

  private readonly onChartTop = (value: string | string[]): void => {
    const v = Array.isArray(value) ? value[0] : value;
    this.chartTop = Number(v) || 0;
  };

  private readonly onClassFilter = (value: string | string[]): void => {
    const v = (Array.isArray(value) ? value[0] : value) as ClassFilter;
    if (CLASS_OPTIONS.some((o) => o.value === v)) this.classFilter = v;
  };
}
