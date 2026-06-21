/**
 * Default, hard-coded **machine dashboard** — a contextualised overlay opened
 * from a machine's detail card when it is NOT linked to a specific WinCC OA
 * dashboard. Four quadrants (per the agreed design):
 *   - left  : "Paramètres Process" — the machine's live process parameters;
 *   - top-r : "Suivi Alarmes" — placeholder encart (alarm tracking: à venir);
 *   - bot-r : "KPI" — a machine-state Gantt timeline + a Pareto of unplanned
 *             stop causes over a configurable period.
 *
 * Data is read live (process params from the machine object) and from the
 * archived history (state timeline + Pareto), reusing the fleet-stop-analysis
 * engine. Rendered with plain SVG/DOM (no echarts) to stay light in this bundle.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { normDp } from '../data/dp-utils.js';
import {
  STATE_LABELS,
  formatStopCause,
  resolveState,
  stateColor,
  type Machine,
  type MachineState,
  type StateMapping,
  type StopCause
} from '../types.js';
import {
  analyseStopCauses,
  formatDuration,
  queryHistory,
  sortRows,
  type AnalysisMachine,
  type CauseRow
} from '../../_vendor/wui-fleet-core/engine.js';

/** A piecewise-constant history sample (mirrors the engine's internal type). */
interface HistorySample {
  t: number;
  v: unknown;
}

interface StateSegment {
  state: MachineState;
  startMs: number;
  endMs: number;
  /** Stop cause label active over the segment (non-ok states), if any. */
  causeLabel?: string;
}

type Period = 'today' | '24h' | '7d' | '30d' | 'week' | 'month' | 'custom';
const PERIOD_LABEL: Record<Period, string> = {
  today: "Aujourd'hui",
  '24h': '24 heures',
  '7d': '7 jours',
  '30d': '30 jours',
  week: 'Cette semaine',
  month: 'Ce mois',
  custom: 'Personnalisé…'
};
const PERIODS = Object.keys(PERIOD_LABEL) as Period[];
const DAY_MS = 86_400_000;
const DATE_FORMAT = 'yyyy-MM-dd';
const END_OF_DAY_MS = DAY_MS - 1;

/** Pareto "show N causes" options (value 0 = all). */
const PARETO_TOP_OPTIONS = [
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '0', label: 'Tous' }
];
const DEFAULT_PARETO_TOP = 5;
/** Pareto metric: cumulated downtime vs. stop frequency (occurrences). */
type ParetoMetric = 'downtime' | 'frequency';
const PARETO_METRIC_OPTIONS: { value: ParetoMetric; label: string }[] = [
  { value: 'downtime', label: "Temps d'arrêt cumulé" },
  { value: 'frequency', label: "Fréquence d'arrêt" }
];
/** Pareto stop-class filter: unplanned vs. planned stops. */
type ParetoClass = 'unplanned' | 'planned';
const PARETO_CLASS_OPTIONS: { value: ParetoClass; label: string }[] = [
  { value: 'unplanned', label: 'Arrêts non planifiés' },
  { value: 'planned', label: 'Arrêts planifiés' }
];
/** Bar palette for the Pareto chart (cycled). */
const BAR_COLORS = ['#f59e0b', '#ef4444', '#d4a5a5', '#9aa1ad', '#8b5cf6', '#10b981'];
const ALL_STATES: MachineState[] = ['ok', 'warn', 'stop', 'maint'];
const DAYS_PER_WEEK = 7;
/** Debounce before re-querying the archived history after a live state change. */
const HISTORY_RELOAD_DEBOUNCE_MS = 1500;

@customElement('mf-machine-dashboard')
export class MfMachineDashboard extends LitElement {
  static override readonly styles = [IXCoreStyles, dashboardStyles()];

  @property({ attribute: false }) machine!: Machine;
  @property({ attribute: false }) mapping: StateMapping | undefined;
  @property({ attribute: false }) stopCauses: StopCause[] = [];
  @property({ attribute: false }) api: OaRxJsApi | null = null;
  @property() atelierId = '';
  @property() atelierName = '';

  @state() private period: Period = '7d';
  /** How far back the window is shifted from "now" (ms); 0 = current period. */
  @state() private offsetMs = 0;
  @state() private customStart = '';
  @state() private customEnd = '';
  @state() private paretoTop = DEFAULT_PARETO_TOP;
  @state() private paretoMetric: ParetoMetric = 'downtime';
  @state() private paretoClass: ParetoClass = 'unplanned';
  @state() private segments: StateSegment[] = [];
  /** Full sorted (desc) list of unplanned causes; sliced per `paretoTop` at render. */
  @state() private pareto: CauseRow[] = [];
  @state() private loading = false;
  @state() private tip: { x: number; y: number; seg: StateSegment } | null = null;
  /** Live DP values from `dpConnect`, keyed by normalised DP name. */
  @state() private liveValues: Record<string, unknown> = {};

  private dpSub = new Subscription();
  /** Normalised state-DP name (to detect state changes in the live stream). */
  private stateKey = '';
  private historyDebounce = 0;

  override render(): TemplateResult {
    const m = this.machine;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <span class="dot" style="background:${stateColor(this.mapping, this.liveState())}"></span>
            <ix-typography format="h3">${m.name}</ix-typography>
            <ix-chip outline>${m.loc ?? m.type}</ix-chip>
            <span class="grow"></span>
            <ix-icon-button ghost icon="close" title="Fermer" @click=${this.close}></ix-icon-button>
          </div>
          <div class="grid">
            <section class="q q-params">
              <h4>Paramètres Process</h4>
              ${this.renderParams()}
            </section>
            ${this.renderToolbar()}
            <section class="q q-alarms">
              <h4>Suivi Alarmes</h4>
              <div class="placeholder">
                <ix-icon name="bell" size="24"></ix-icon>
                <span>Suivi des alarmes — non disponible (à venir).</span>
              </div>
            </section>
            <section class="q q-kpi">
              ${this.loading
                ? html`<div class="center"><ix-spinner></ix-spinner></div>`
                : html`${this.renderGantt()} ${this.renderPareto()}`}
            </section>
          </div>
        </div>
      </div>
      ${this.renderTip()}
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dpSub.unsubscribe();
    window.clearTimeout(this.historyDebounce);
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
    this.connectLive();
  }

  /** Subscribe to the machine's live DPs (state + process params) via dpConnect —
   * same mechanism as the 3D view / popup. Process params update reactively; a
   * state change re-queries the archived history so the Gantt stays live. */
  private connectLive(): void {
    const api = this.api;
    const m = this.machine;
    if (!api) return;
    const dps = [m.stateDp, ...(m.kpis ?? []).map((k) => k.dp)].filter(
      (d): d is string => typeof d === 'string' && d !== ''
    );
    if (dps.length === 0) return;
    this.stateKey = m.stateDp ? normDp(m.stateDp) : '';
    try {
      this.dpSub = api.dpConnect(dps, true).subscribe({
        next: (e: { dp: string[]; value: unknown[] }) => this.onLive(e),
        error: () => this.requestUpdate()
      });
    } catch {
      // dpConnect failed (e.g. an unbound DP) — params fall back to static values.
    }
  }

  private onLive(e: { dp: string[]; value: unknown[] }): void {
    const live: Record<string, unknown> = { ...this.liveValues };
    let stateChanged = false;
    for (const [i, name] of e.dp.entries()) {
      const key = normDp(name);
      live[key] = e.value[i];
      if (key === this.stateKey) stateChanged = true;
    }
    this.liveValues = live;
    // A state transition changes the Gantt timeline → re-query (debounced).
    if (stateChanged) {
      window.clearTimeout(this.historyDebounce);
      this.historyDebounce = window.setTimeout(() => void this.reload(true), HISTORY_RELOAD_DEBOUNCE_MS);
    }
  }

  /** Period filter governing the whole right side (Suivi Alarmes + KPI). */
  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-icon-button
          ghost
          icon="chevron-left"
          title="Période précédente"
          @click=${() => this.shiftPeriod(1)}
        ></ix-icon-button>
        <label class="ctl">
          <span>Période</span>
          <ix-select
            .value=${this.period}
            @valueChange=${(e: CustomEvent<string | string[]>) => this.onPeriod(e.detail)}
          >
            ${PERIODS.map(
              (p) => html`<ix-select-item value=${p} label=${PERIOD_LABEL[p]}></ix-select-item>`
            )}
          </ix-select>
        </label>
        <ix-icon-button
          ghost
          icon="chevron-right"
          title="Période suivante"
          ?disabled=${this.offsetMs === 0}
          @click=${() => this.shiftPeriod(-1)}
        ></ix-icon-button>
        ${this.period === 'custom'
          ? html`
              <label class="ctl">
                <span>Début</span>
                <ix-date-input
                  format=${DATE_FORMAT}
                  .value=${this.customStart}
                  @valueChange=${(e: CustomEvent<string>) => this.onCustomDate('start', e.detail)}
                ></ix-date-input>
              </label>
              <label class="ctl">
                <span>Fin</span>
                <ix-date-input
                  format=${DATE_FORMAT}
                  .value=${this.customEnd}
                  @valueChange=${(e: CustomEvent<string>) => this.onCustomDate('end', e.detail)}
                ></ix-date-input>
              </label>
            `
          : ''}
        <span class="grow"></span>
        <span class="range">${this.rangeLabel()}</span>
      </div>
    `;
  }

  /** "du <début> au <fin>" for the resolved period — always shown. */
  private rangeLabel(): string {
    const { start, end } = this.resolveRange();
    return `du ${formatDateTime(start.getTime())} au ${formatDateTime(end.getTime())}`;
  }

  private renderParams(): TemplateResult {
    const kpis = this.machine.kpis ?? [];
    if (kpis.length === 0) return html`<div class="muted">Aucun paramètre process configuré.</div>`;
    return html`
      <div class="params">
        ${kpis.map((k) => {
          // Prefer the live dpConnect value; fall back to the last known value.
          const live = k.dp ? extractScalar(this.liveValues[normDp(k.dp)]) : undefined;
          const value = live ?? k.value;
          return html`
            <div class="param">
              <span class="param-label">${k.label}</span>
              <span class="param-value"
                >${value ?? '—'}${value != null && k.unit ? ` ${k.unit}` : ''}</span
              >
            </div>
          `;
        })}
      </div>
    `;
  }

  /** Current state from the live stream when available, else the machine's state. */
  private liveState(): MachineState {
    const raw = this.stateKey ? this.liveValues[this.stateKey] : undefined;
    if (raw == null) return this.machine.state;
    return resolveState(this.mapping, Math.round(Number(extractScalar(raw))));
  }

  /** Machine-state Gantt: proportional, coloured timeline of the state history. */
  private renderGantt(): TemplateResult {
    const segs = this.segments;
    const head = html`
      <div class="block-head">
        <div class="block-title">Gantt état machine</div>
        <span class="grow"></span>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title="Exporter le Gantt (CSV)"
          ?disabled=${segs.length === 0}
          @click=${this.exportGanttCsv}
        ></ix-icon-button>
      </div>
    `;
    if (segs.length === 0) {
      return html`${head}<div class="muted small">Aucune donnée d'historique sur la période.</div>`;
    }
    const start = segs[0].startMs;
    const total = segs.at(-1)!.endMs - start || 1;
    return html`
      ${head}
      <svg class="gantt" viewBox="0 0 100 10" preserveAspectRatio="none">
        ${segs.map((s) => {
          const x = ((s.startMs - start) / total) * 100;
          const w = ((s.endMs - s.startMs) / total) * 100;
          return svg`<rect x=${x} y="0" width=${Math.max(w, 0.2)} height="10"
            fill=${stateColor(this.mapping, s.state)}
            @pointermove=${(e: PointerEvent) => this.showTip(e, s)}
            @pointerleave=${() => (this.tip = null)}></rect>`;
        })}
      </svg>
      <div class="legend">
        ${this.mappingStates().map(
          (st) => html`<span class="leg"
            ><i style="background:${stateColor(this.mapping, st)}"></i>${STATE_LABELS[st]}</span
          >`
        )}
      </div>
    `;
  }

  private readonly exportGanttCsv = (): void => {
    const rows: string[][] = [['Début', 'Fin', 'État', "Cause d'arrêt"]];
    for (const s of this.segments) {
      rows.push([
        formatDateTime(s.startMs),
        formatDateTime(s.endMs),
        STATE_LABELS[s.state],
        s.causeLabel ?? ''
      ]);
    }
    downloadCsv(`gantt_${this.machine.id}.csv`, rows);
  };

  /** Hover bubble for a Gantt segment: start/end, state and any stop cause. */
  private renderTip(): TemplateResult {
    const tip = this.tip;
    if (!tip) return html``;
    const s = tip.seg;
    return html`
      <div class="gantt-tip" style="left:${tip.x}px;top:${tip.y}px">
        <div class="tip-state" style="color:${stateColor(this.mapping, s.state)}">${STATE_LABELS[s.state]}</div>
        <div>Début : ${formatDateTime(s.startMs)}</div>
        <div>Fin : ${formatDateTime(s.endMs)}</div>
        ${s.causeLabel ? html`<div>Cause : ${s.causeLabel}</div>` : ''}
      </div>
    `;
  }

  private showTip(e: PointerEvent, seg: StateSegment): void {
    this.tip = { x: e.clientX, y: e.clientY, seg };
  }

  /** States produced by the machine's state mapping (rules + fallback), in
   * canonical order — so the Gantt legend conforms to that machine's mapping. */
  private mappingStates(): MachineState[] {
    const mp = this.mapping;
    if (!mp) return ALL_STATES;
    const present = new Set<MachineState>(mp.rules.map((r) => r.state));
    present.add(mp.fallback);
    return ALL_STATES.filter((s) => present.has(s));
  }

  private metricVal(r: CauseRow): number {
    return this.paretoMetric === 'downtime' ? r.downtimeMs : r.occurrences;
  }

  /** Pareto of stop causes (planned/unplanned): bars (downtime or frequency) + cumulative curve. */
  private renderPareto(): TemplateResult {
    const sorted = this.paretoRows();
    const rows = this.paretoTop > 0 ? sorted.slice(0, this.paretoTop) : sorted;
    const head = html`
      <div class="block-head">
        <div class="block-title">Pareto des arrêts</div>
        <span class="grow"></span>
        <ix-select
          class="class-select"
          .value=${this.paretoClass}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoClass(e.detail)}
        >
          ${PARETO_CLASS_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          class="metric-select"
          .value=${this.paretoMetric}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoMetric(e.detail)}
        >
          ${PARETO_METRIC_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          class="top-select"
          .value=${String(this.paretoTop)}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoTop(e.detail)}
        >
          ${PARETO_TOP_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`
          )}
        </ix-select>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title="Exporter le Pareto (CSV)"
          ?disabled=${sorted.length === 0}
          @click=${this.exportParetoCsv}
        ></ix-icon-button>
        <ix-button
          variant="secondary"
          title="Ouvrir l'analyse des causes d'arrêts filtrée sur cette machine"
          @click=${this.openAnalysis}
        >
          <ix-icon name="analysis" slot="icon"></ix-icon>Analyser
        </ix-button>
      </div>
    `;
    if (rows.length === 0) {
      const label = this.paretoClass === 'planned' ? 'planifié' : 'non planifié';
      return html`${head}<div class="muted small">Aucun arrêt ${label} sur la période.</div>`;
    }
    return html`${head}${this.renderParetoChart(rows, sorted)}`;
  }

  /** A true Pareto chart (SVG): descending bars + cumulative-% line and axes. */
  private renderParetoChart(rows: CauseRow[], allSorted: CauseRow[]): TemplateResult {
    const W = 760;
    const H = 300;
    const padL = 46;
    const padR = 46;
    const padT = 14;
    const padB = 96;
    const x0 = padL;
    const x1 = W - padR;
    const y0 = padT;
    const y1 = H - padB;
    const plotH = y1 - y0;
    const step = (x1 - x0) / rows.length;
    const barW = Math.min(step * 0.62, 64);
    const maxVal = Math.max(...rows.map((r) => this.metricVal(r)), 1);
    const totalAll = allSorted.reduce((s, r) => s + this.metricVal(r), 0) || 1;
    const metric = this.paretoMetric;
    const fmt = (v: number): string => formatMetric(metric, v);
    const axisColor = 'var(--theme-color-soft-bdr)';
    const textColor = 'var(--theme-color-soft-text)';
    let cum = 0;
    const pts = rows.map((r, i) => {
      cum += this.metricVal(r);
      return { cx: x0 + (i + 0.5) * step, y: y1 - (cum / totalAll) * plotH, pct: (cum / totalAll) * 100 };
    });
    const polyline = pts.map((p) => `${p.cx.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return html`
      <svg class="pareto-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line x1=${x0} y1=${y0} x2=${x0} y2=${y1} stroke=${axisColor}></line>
        <line x1=${x1} y1=${y0} x2=${x1} y2=${y1} stroke=${axisColor}></line>
        <line x1=${x0} y1=${y1} x2=${x1} y2=${y1} stroke=${axisColor}></line>
        ${[0, 50, 100].map((p) => {
          const y = y1 - (p / 100) * plotH;
          return svg`<text x=${x1 + 6} y=${y + 3} fill=${textColor} font-size="11">${p}%</text>`;
        })}
        <text x=${x0 - 6} y=${y0 + 8} text-anchor="end" fill=${textColor} font-size="11">${fmt(maxVal)}</text>
        ${rows.map((r, i) => {
          const h = (this.metricVal(r) / maxVal) * plotH;
          const x = x0 + (i + 0.5) * step - barW / 2;
          return svg`<rect x=${x} y=${y1 - h} width=${barW} height=${Math.max(h, 1)}
            rx="2" fill=${BAR_COLORS[i % BAR_COLORS.length]}><title>${r.label} — ${fmt(this.metricVal(r))}</title></rect>
            <text x=${x0 + (i + 0.5) * step} y=${y1 - h - 4} text-anchor="middle" fill=${textColor} font-size="10">${fmt(this.metricVal(r))}</text>
            <text x=${x0 + (i + 0.5) * step} y=${y1 + 12} transform="rotate(35 ${x0 + (i + 0.5) * step} ${y1 + 12})" fill=${textColor} font-size="10">${truncate(r.label, 22)}</text>`;
        })}
        <polyline points=${polyline} fill="none" stroke="var(--theme-color-primary)" stroke-width="2"></polyline>
        ${pts.map(
          (p) => svg`<circle cx=${p.cx} cy=${p.y} r="3" fill="var(--theme-color-primary)"><title>${p.pct.toFixed(1)} %</title></circle>`
        )}
      </svg>
    `;
  }

  private onParetoMetric(value: string | string[]): void {
    const v = (Array.isArray(value) ? value[0] : value) as ParetoMetric;
    if (v === 'downtime' || v === 'frequency') this.paretoMetric = v;
  }

  private onParetoClass(value: string | string[]): void {
    const v = (Array.isArray(value) ? value[0] : value) as ParetoClass;
    if (v === 'unplanned' || v === 'planned') this.paretoClass = v;
  }

  private readonly exportParetoCsv = (): void => {
    const sorted = this.paretoRows();
    const totalAll = sorted.reduce((s, r) => s + this.metricVal(r), 0) || 1;
    const rows: string[][] = [
      ['Cause', 'Classification', "Temps d'arrêt (s)", "Temps d'arrêt", 'Occurrences', 'Cumul %']
    ];
    let cum = 0;
    for (const r of sorted) {
      cum += this.metricVal(r);
      rows.push([
        r.label,
        r.classification ?? '',
        String(Math.round(r.downtimeMs / 1000)),
        formatDuration(r.downtimeMs),
        String(r.occurrences),
        ((cum / totalAll) * 100).toFixed(1)
      ]);
    }
    downloadCsv(`pareto_${this.machine.id}.csv`, rows);
  };

  private onPeriod(value: string | string[]): void {
    const v = (Array.isArray(value) ? value[0] : value) as Period;
    if (!(v in PERIOD_LABEL)) return;
    this.period = v;
    this.offsetMs = 0;
    if (v === 'custom' && (this.customStart === '' || this.customEnd === '')) {
      const now = new Date();
      this.customEnd = toDateStr(now);
      this.customStart = toDateStr(new Date(now.getTime() - DAYS_PER_WEEK * DAY_MS));
    }
    void this.reload();
  }

  private onCustomDate(which: 'start' | 'end', value: string): void {
    if (which === 'start') this.customStart = value;
    else this.customEnd = value;
    this.offsetMs = 0;
    void this.reload();
  }

  /** Jump to the previous (dir = +1) or next (dir = -1) period of the same length.
   * "Aujourd'hui" (a partial day) is snapped to a full 1-day window when shifting. */
  private shiftPeriod(dir: number): void {
    if (this.period === 'today') this.period = '24h';
    this.offsetMs = Math.max(0, this.offsetMs + dir * this.periodUnitMs());
    void this.reload();
  }

  /** The shift step (and shifted-window length) for the current period. */
  private periodUnitMs(): number {
    if (this.period === '24h' || this.period === 'today') return DAY_MS;
    if (this.period === '7d' || this.period === 'week') return DAYS_PER_WEEK * DAY_MS;
    if (this.period === '30d' || this.period === 'month') return 30 * DAY_MS;
    const base = this.baseRange();
    return base.end.getTime() - base.start.getTime();
  }

  private onParetoTop(value: string | string[]): void {
    const v = Array.isArray(value) ? value[0] : value;
    this.paretoTop = Number(v) || 0;
  }

  /** Open the stop-cause analysis page in a NEW TAB, pre-filtered on this machine
   * (filter passed via the URL hash query so it survives the new-tab load). */
  private readonly openAnalysis = (): void => {
    const base = window.location.href.split('#')[0];
    const q = `atelier=${encodeURIComponent(this.atelierId)}&machine=${encodeURIComponent(this.machine.id)}`;
    window.open(`${base}#/fleet-stops?${q}`, '_blank', 'noopener');
  };

  private async reload(silent = false): Promise<void> {
    const m = this.machine;
    if (!this.api || !m.stateDp) {
      this.segments = [];
      this.pareto = [];
      return;
    }
    if (!silent) this.loading = true;
    const { start, end } = this.resolveRange();
    if (start >= end) {
      this.loading = false;
      return;
    }
    this.segments = await this.buildSegments(m, start, end);
    this.pareto = m.stopCauseDp ? await this.buildPareto(m, start, end) : [];
    this.loading = false;
  }

  /** [start, end] for the selected period, shifted back by `offsetMs` (prev/next). */
  private resolveRange(): { start: Date; end: Date } {
    const base = this.baseRange();
    if (this.offsetMs === 0) return base;
    const unit = this.periodUnitMs();
    const endMs = base.end.getTime() - this.offsetMs;
    return { start: new Date(endMs - unit), end: new Date(endMs) };
  }

  /** The "current" (un-shifted) window for the selected period. */
  private baseRange(): { start: Date; end: Date } {
    const end = new Date();
    if (this.period === 'custom') {
      const s = parseDate(this.customStart, false) ?? new Date(end.getTime() - DAYS_PER_WEEK * DAY_MS);
      const parsedEnd = parseDate(this.customEnd, true) ?? end;
      // Never analyse into the future.
      return { start: s, end: new Date(Math.min(parsedEnd.getTime(), end.getTime())) };
    }
    if (this.period === 'today') return { start: startOfDay(end), end };
    if (this.period === 'week') return { start: startOfWeek(end), end };
    if (this.period === 'month') {
      return { start: new Date(end.getFullYear(), end.getMonth(), 1), end };
    }
    const days = this.period === '24h' ? 1 : (this.period === '7d' ? DAYS_PER_WEEK : 30);
    return { start: new Date(end.getTime() - days * DAY_MS), end };
  }

  private async buildSegments(m: Machine, start: Date, end: Date): Promise<StateSegment[]> {
    const samples = await queryHistory(this.api, m.stateDp ?? '', start, end);
    if (samples.length === 0) return [];
    const causeSamples: HistorySample[] = m.stopCauseDp
      ? await queryHistory(this.api, m.stopCauseDp, start, end)
      : [];
    const startMs = start.getTime();
    const endMs = end.getTime();
    const segs: StateSegment[] = [];
    for (const [i, s] of samples.entries()) {
      const segStart = Math.max(s.t, startMs);
      const segEnd = Math.min(samples[i + 1] ? samples[i + 1].t : endMs, endMs);
      if (segEnd <= segStart) continue;
      const state = resolveState(this.mapping, Math.round(Number(s.v)));
      const causeLabel = state === 'ok' ? undefined : this.causeAt(causeSamples, segStart);
      const last = segs.at(-1);
      if (last && last.state === state && last.causeLabel === causeLabel && last.endMs >= segStart) {
        last.endMs = segEnd;
      } else {
        segs.push({ state, startMs: segStart, endMs: segEnd, causeLabel });
      }
    }
    return segs;
  }

  /** Stop-cause label active at time `t` (catalog-resolved), or undefined. */
  private causeAt(samples: HistorySample[], t: number): string | undefined {
    let code = '';
    for (const s of samples) {
      if (s.t > t) break;
      code = s.v == null ? '' : String(s.v).trim();
    }
    return code === '' ? undefined : formatStopCause(this.stopCauses, code);
  }

  private async buildPareto(m: Machine, start: Date, end: Date): Promise<CauseRow[]> {
    const target: AnalysisMachine = {
      atelierId: this.atelierId,
      atelierName: this.atelierName,
      machineId: m.id,
      machineName: m.name,
      stateDp: m.stateDp ?? '',
      stopCauseDp: m.stopCauseDp ?? '',
      mapping: this.mapping
    };
    const result = await analyseStopCauses(this.api, [target], this.stopCauses, start, end);
    // Keep both planned & unplanned; the Pareto filters by the chosen class.
    return result.rows.filter(
      (r) => r.classification === 'unplanned' || r.classification === 'planned'
    );
  }

  /** Pareto rows for the current class, sorted by the current metric. */
  private paretoRows(): CauseRow[] {
    const inClass = this.pareto.filter((r) => r.classification === this.paretoClass);
    return sortRows(inClass, this.paretoMetric === 'downtime' ? 'downtime' : 'occurrences');
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };
}

/** Truncate a label to `max` chars with an ellipsis. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Format a Pareto metric value: a duration (downtime) or a count (frequency). */
function formatMetric(metric: ParetoMetric, v: number): string {
  return metric === 'downtime' ? formatDuration(v) : String(v);
}

/** Escape a CSV cell (French `;` separator, quote when needed). */
function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

/** Build a `;`-separated CSV (UTF-8 BOM for Excel accents) and trigger a download. */
function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((r) => r.map((c) => csvCell(c)).join(';')).join('\r\n');
  // Prepend a UTF-8 BOM (U+FEFF) so Excel renders accents correctly.
  const bom = String.fromCodePoint(0xFE_FF);
  const url = URL.createObjectURL(new Blob([bom, csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Coerce a (possibly array-wrapped) DP value to a display scalar. */
function extractScalar(raw: unknown): number | string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return v == null ? undefined : String(v);
}

/** Format a ms-epoch timestamp as a French date+time. */
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

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

/** Monday 00:00 of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const dow = (day.getDay() + 6) % DAYS_PER_WEEK; // 0 = Monday
  return new Date(day.getTime() - dow * DAY_MS);
}

// eslint-disable-next-line max-lines-per-function -- single component stylesheet
function dashboardStyles() {
  return css`
    :host {
      color: var(--theme-color-std-text);
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
      width: 1320px;
      max-width: 96vw;
      height: 88vh;
      display: flex;
      flex-direction: column;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-head .dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
    }
    .grow {
      flex: 1;
    }
    .grid {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 2fr;
      grid-template-rows: auto 1fr 2fr;
      grid-template-areas: 'params toolbar' 'params alarms' 'params kpi';
      gap: 0.75rem;
      padding: 0.75rem;
      overflow: hidden;
    }
    .toolbar {
      grid-area: toolbar;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    .ctl {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .q {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.75rem;
      overflow: auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .q-params {
      grid-area: params;
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    .q-alarms {
      grid-area: alarms;
      background: var(--theme-color-1);
    }
    .q-kpi {
      grid-area: kpi;
      background: color-mix(in srgb, #10b981 8%, transparent);
    }
    .q h4 {
      margin: 0 0 0.5rem;
      font-size: 0.95rem;
    }
    .placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--theme-color-soft-text);
      text-align: center;
    }
    .params {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .param {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.3rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .param-label {
      color: var(--theme-color-soft-text);
    }
    .param-value {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .block-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.6rem 0 0.3rem;
    }
    .block-title {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      margin: 0.5rem 0 0.3rem;
    }
    .block-head .block-title {
      margin: 0;
    }
    .top-select {
      min-width: 7rem;
    }
    .metric-select {
      min-width: 11rem;
    }
    .class-select {
      min-width: 11rem;
    }
    .range {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    .gantt {
      width: 100%;
      height: 52px;
      border-radius: 0.2rem;
      background: var(--theme-color-1);
    }
    .gantt rect {
      cursor: pointer;
    }
    .gantt-tip {
      position: fixed;
      z-index: 10000;
      transform: translate(12px, 12px);
      pointer-events: none;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      padding: 0.4rem 0.6rem;
      font-size: 0.74rem;
      line-height: 1.4;
      white-space: nowrap;
    }
    .tip-state {
      font-weight: 700;
      margin-bottom: 0.15rem;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.35rem;
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .leg {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .leg i {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 0.15rem;
    }
    .pareto-svg {
      width: 100%;
      flex: 1;
      min-height: 200px;
      margin-top: 0.25rem;
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .small {
      font-size: 0.8rem;
    }
    /* Print: keep the overlay content, drop the dim backdrop, force colours
       (bars/segments) to render and let the panel grow so nothing is clipped. */
    @media print {
      .overlay {
        position: static;
        background: none;
        padding: 0;
        display: block;
      }
      .panel {
        width: 100%;
        max-width: none;
        height: auto;
        box-shadow: none;
        border: none;
      }
      .grid {
        overflow: visible;
      }
      .q {
        overflow: visible;
        break-inside: avoid;
      }
      .gantt rect,
      .pareto-svg rect,
      .pareto-svg polyline,
      .pareto-svg circle,
      .leg i,
      .panel-head .dot {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
}
