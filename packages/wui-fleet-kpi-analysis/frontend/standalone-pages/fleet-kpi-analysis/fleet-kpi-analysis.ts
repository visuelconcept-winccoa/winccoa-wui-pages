/**
 * Fleet KPI Analysis — Standalone page (WinCC OA WebUI Runtime).
 *
 * Reached from the Machine Fleet 3D overview ("Analyse des KPI"). Computes the
 * availability-based TRS per machine over a configurable period (default: last
 * month), with the same atelier / machine filters as the stop-cause page, and
 * two views (table + bar chart). One bar per machine, height = TRS.
 *
 * Registered at `/fleet-kpi` (component `wui-fleet-kpi-analysis`). Reuses the
 * Machine Fleet 3D {@link FleetStore} for atelier configs and the stop-cause
 * catalog, and the stop-cause engine's history/interval algorithm via
 * {@link analyseKpi}. `echarts` is resolved via the shared-bundle import map.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import { pageStyles } from './_vendor/wui-fleet-core/styles.js';
import { FleetStore } from './_vendor/wui-fleet-core/data/fleet-store.js';
import {
  DEFAULT_TRS_THRESHOLDS,
  resolveTrsColor,
  type Atelier,
  type StopCause,
  type TrsThresholds
} from './_vendor/wui-fleet-core/types.js';
import {
  analyseKpi,
  collectMachines,
  formatDuration,
  formatPct,
  sortByTrs,
  type KpiResult,
  type KpiRow
} from './fleet-kpi-analysis/engine.js';
import {
  buildNonWorkedMap,
  emptyClosureConfig,
  normaliseClosures,
  type ClosureConfig
} from './_vendor/wui-fleet-core/closures.js';

const TAB_TABLE = 0;
const TAB_CHART = 1;
const DEBOUNCE_MS = 300;

/** Sortable columns of the KPI table. */
type KpiSortCol = 'machine' | 'trs' | 'unplanned' | 'planned';
type SortDir = 'asc' | 'desc';
const DATE_FORMAT = 'yyyy-MM-dd';
const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;
const PCT = 100;

/** Coerce an ix-select value (string | string[]) to a string array. */
function toList(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

@customElement('wui-fleet-kpi-analysis')
export class WuiFleetKpiAnalysis extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private ateliers: Atelier[] = [];
  @state() private catalog: StopCause[] = [];
  @state() private selectedAteliers: string[] = [];
  @state() private selectedMachines: string[] = [];
  @state() private startStr = '';
  @state() private endStr = '';
  @state() private machineSearch = '';
  @state() private kpiSortCol: KpiSortCol = 'trs';
  @state() private kpiSortDir: SortDir = 'asc';
  @state() private tab = TAB_TABLE;
  @state() private result: KpiResult | null = null;
  @state() private loading = false;
  @state() private offline = false;
  /** Loaded for the TRS computation; edited on the dedicated /fleet-closures page. */
  @state() private closures: ClosureConfig = emptyClosureConfig();
  /** machineId → its TRS threshold config (resolved from the atelier configs). */
  private trsConfigByMachine = new Map<string, TrsThresholds>();

  private readonly store = new FleetStore();
  private readonly api = this.resolveApi();
  private debounceId = 0;
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.initDefaultRange();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.debounceId) window.clearTimeout(this.debounceId);
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: { 'en_US.utf8': 'KPI Analysis', 'fr.utf8': 'Analyse des KPI' }
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>
      <div class="body">
        ${this.renderToolbar()} ${this.renderOffline()} ${this.renderTabs()} ${this.renderContent()}
      </div>
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
        <span class="sep"></span>
        ${this.renderDateField('Début', this.startStr, 'start')}
        ${this.renderDateField('Fin', this.endStr, 'end')} ${this.renderAtelierField()}
        ${this.renderMachineField()}
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
    return this.tab === TAB_TABLE ? this.renderTable(result) : this.renderChartHost();
  }

  private renderTable(result: KpiResult): TemplateResult {
    const rows = this.visibleRows(result);
    const totalPlanned = rows.reduce((s, r) => s + r.plannedMs, 0);
    const totalUnplanned = rows.reduce((s, r) => s + r.unplannedMs, 0);
    const totalRequired = rows.reduce((s, r) => s + r.requiredMs, 0);
    const fleetTrs = totalRequired > 0 ? (totalRequired - totalUnplanned) / totalRequired : 1;
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
                ${this.kpiHeader('Machine', 'machine')}
                ${this.kpiHeader('TRS (disponibilité)', 'trs', true)}
                ${this.kpiHeader('Arrêt non planifié', 'unplanned', true)}
                ${this.kpiHeader('Arrêt planifié', 'planned', true)}
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => this.renderRow(r))}
            </tbody>
            <tfoot>
              <tr>
                <td>Parc (${rows.length})</td>
                <td class="num">${formatPct(fleetTrs)}</td>
                <td class="num">${formatDuration(totalUnplanned)}</td>
                <td class="num">${formatDuration(totalPlanned)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  /** KPI rows after the machine search, sorted by the active column. */
  private visibleRows(result: KpiResult): KpiRow[] {
    let rows = result.rows;
    const q = this.machineSearch.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    if (this.kpiSortCol === 'trs' && this.kpiSortDir === 'asc') return sortByTrs(rows);
    const dir = this.kpiSortDir === 'asc' ? 1 : -1;
    const col = this.kpiSortCol;
    const value = (r: KpiRow): number | string => {
      if (col === 'machine') return r.name;
      if (col === 'unplanned') return r.unplannedMs;
      if (col === 'planned') return r.plannedMs;
      return r.availability;
    };
    return [...rows].sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      const va = value(a);
      const vb = value(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return dir * c;
    });
  }

  private kpiHeader(label: string, col: KpiSortCol, num = false): TemplateResult {
    const active = this.kpiSortCol === col;
    const arrow = active ? (this.kpiSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return html`<th
      class="sortable ${num ? 'num' : ''}"
      @click=${() => this.onKpiSort(col)}
    >${label}${arrow}</th>`;
  }

  private onKpiSort(col: KpiSortCol): void {
    if (this.kpiSortCol === col) {
      this.kpiSortDir = this.kpiSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.kpiSortCol = col;
      // TRS defaults ascending (worst first); machine name ascending; durations descending.
      this.kpiSortDir = col === 'unplanned' || col === 'planned' ? 'desc' : 'asc';
    }
  }

  private renderRow(r: KpiRow): TemplateResult {
    const name = this.ateliers.length > 1 ? `${r.name} · ${r.atelierName}` : r.name;
    if (!r.hasData) {
      return html`<tr>
        <td>${name}</td>
        <td class="num muted">— <em>(pas d'historique)</em></td>
        <td class="num muted">—</td>
        <td class="num muted">—</td>
      </tr>`;
    }
    const pct = Math.round(r.availability * PCT);
    return html`
      <tr>
        <td>${name}</td>
        <td class="num">
          <div class="bar-cell">
            <span class="bar" style="--p:${pct}%;background:${this.trsColor(r.id, r.availability)}"></span>
            <span>${formatPct(r.availability)}</span>
          </div>
        </td>
        <td class="num">${formatDuration(r.unplannedMs)}</td>
        <td class="num">${formatDuration(r.plannedMs)}</td>
      </tr>
    `;
  }

  private renderChartHost(): TemplateResult {
    return html`<div class="chart" id="chart"></div>`;
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

  private chartOption(result: KpiResult): echarts.EChartsCoreOption {
    const rows = sortByTrs(result.rows).filter((r) => r.hasData);
    const text = this.cssVar('--theme-color-std-text', '#e8e8e8');
    const data = rows.map((r) => ({
      value: Math.round(r.availability * PCT * 10) / 10,
      itemStyle: { color: this.trsColor(r.id, r.availability) }
    }));
    return {
      backgroundColor: 'transparent',
      textStyle: { color: text },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: unknown) => `${Number(v).toLocaleString('fr-FR')} %`
      },
      grid: { left: 8, right: 24, bottom: 8, top: 24, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) =>
          this.ateliers.length > 1 ? `${r.name} · ${r.atelierName}` : r.name
        ),
        axisLabel: { color: text, interval: 0, rotate: rows.length > 6 ? 30 : 0 }
      },
      yAxis: {
        type: 'value',
        name: 'TRS %',
        min: 0,
        max: PCT,
        nameTextStyle: { color: text },
        axisLabel: { color: text, formatter: '{value} %' },
        splitLine: { lineStyle: { color: this.cssVar('--theme-color-soft-bdr', '#444') } }
      },
      series: [
        {
          name: 'TRS',
          type: 'bar',
          barMaxWidth: 48,
          data
        }
      ]
    };
  }

  // --- data flow -------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.store.listAteliers();
    this.catalog = await this.store.listStopCauses();
    this.closures = normaliseClosures(await this.store.listClosures());
    this.buildTrsConfigMap();
    this.offline = this.store.offline;
    await this.recompute();
  }

  /** Resolve each machine's TRS threshold config from its atelier. */
  private buildTrsConfigMap(): void {
    const map = new Map<string, TrsThresholds>();
    for (const a of this.ateliers) {
      const configs = a.trsThresholds ?? DEFAULT_TRS_THRESHOLDS;
      for (const m of a.machines) {
        map.set(m.id, configs.find((c) => c.id === m.trsThresholdId) ?? configs[0] ?? DEFAULT_TRS_THRESHOLDS[0]);
      }
    }
    this.trsConfigByMachine = map;
  }

  /** Band colour for a machine's TRS, using its configured thresholds. */
  private trsColor(machineId: string, ratio: number): string {
    return resolveTrsColor(this.trsConfigByMachine.get(machineId), ratio * PCT);
  }

  private async recompute(): Promise<void> {
    const start = this.parseDate(this.startStr, false);
    const end = this.parseDate(this.endStr, true);
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
    this.result = await analyseKpi(this.api, machines, this.catalog, start, end, nonWorked);
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
}
