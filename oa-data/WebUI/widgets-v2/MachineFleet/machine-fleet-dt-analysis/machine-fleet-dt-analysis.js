// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `mf-widget-dt-analysis` — **Machine Fleet downtime analysis** dashboard widget.
 *
 * The stop-cause Pareto of the fleet's built-in machine dashboard, as a WinCC OA
 * dashboard widget, for ONE machine over the dashboard time range:
 *   - a KPI strip (availability, unplanned downtime, failures, MTBF, MTTR — the
 *     kpiCalc formulas, computed on the window without closures);
 *   - a Pareto chart of the stop causes (bars = downtime or frequency, cumulative
 *     % line), filtered by stop class (planned / unplanned) and Top N;
 *   - an optional table of the same rows, and a CSV export.
 *
 * Inputs (set by the dashboard's context layer — the widget never queries):
 *   state / cause   archived histories `{ value: { values, timestamps }, name }`
 *                   of `MachineSim_<m>.state` and `MachineSim_<m>.cause`.
 *   stateMapping    JSON (atelier config, mapping list or one mapping);
 *                   machineId / stateMappingId select the mapping inside it.
 *   stopCauses      JSON catalog (`MachineFleet3D_StopCauses.json`) — gives each
 *                   code its label AND its planned/unplanned classification.
 *   sTimeRange      the dashboard time range (spread from the widget `variables`).
 *   stopClass       'unplanned' | 'planned'   metric  'downtime' | 'frequency'
 *   topN            '5' | '10' | '0' (all)     showKpis / showTable / showRangePicker
 *
 * The header selects change the view only for the current session; the widget
 * settings hold the defaults. The range button dispatches `wui:changedaterange`,
 * which the `data-point` contexts above the widget handle by re-querying.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import '@wincc-oa/wui-ui-elements/wui-datetime-range-button/wui-datetime-range-button.js';
import {
  CLASS_LABELS,
  analyseStops,
  downloadCsv,
  fileSlug,
  formatDuration,
  formatPercent,
  ml,
  parseCatalog,
  parseMapping,
  resolveWindow,
  sortRows,
  t,
  toSamples
} from '../machine-fleet-core.js';

const MSG = {
  noBinding: ml(
    'Bind the machine state and stop-cause datapoints in the widget settings.',
    'Liez les datapoints d’état machine et de cause d’arrêt dans les paramètres du widget.',
    'Binden Sie die Datenpunkte Maschinenzustand und Stillstandsursache in den Widget-Einstellungen.'
  ),
  noHistory: ml(
    'No archived state in this period.',
    'Aucun état archivé sur cette période.',
    'Kein archivierter Zustand in diesem Zeitraum.'
  ),
  noStops: ml(
    'No {class} stop in this period.',
    'Aucun arrêt {class} sur cette période.',
    'Kein {class} Stillstand in diesem Zeitraum.'
  ),
  exportCsv: ml(
    'Export the analysis (CSV)',
    'Exporter l’analyse (CSV)',
    'Analyse exportieren (CSV)'
  ),
  availability: ml('Availability', 'Disponibilité', 'Verfügbarkeit'),
  unplannedDowntime: ml(
    'Unplanned downtime',
    'Arrêts non planifiés',
    'Ungeplante Stillstände'
  ),
  plannedDowntime: ml(
    'Planned downtime',
    'Arrêts planifiés',
    'Geplante Stillstände'
  ),
  failures: ml('Failures', 'Pannes', 'Ausfälle'),
  mtbf: 'MTBF',
  mttr: 'MTTR',
  covered: ml('covered', 'couvert', 'abgedeckt'),
  metricDowntime: ml('Downtime', 'Temps d’arrêt', 'Stillstandszeit'),
  metricFrequency: ml('Frequency', 'Fréquence', 'Häufigkeit'),
  topAll: ml('All', 'Toutes', 'Alle'),
  colCause: ml('Cause', 'Cause', 'Ursache'),
  colClass: ml('Class', 'Classe', 'Klasse'),
  colDowntime: ml('Downtime', 'Temps d’arrêt', 'Stillstandszeit'),
  colDowntimeSec: ml(
    'Downtime (s)',
    'Temps d’arrêt (s)',
    'Stillstandszeit (s)'
  ),
  colOccurrences: ml('Occurrences', 'Occurrences', 'Vorkommen'),
  colCumul: ml('Cumulative %', 'Cumul %', 'Kumuliert %')
};

const CLASS_OPTIONS = ['unplanned', 'planned'];
const METRIC_OPTIONS = [
  { value: 'downtime', label: MSG.metricDowntime },
  { value: 'frequency', label: MSG.metricFrequency }
];
const TOP_OPTIONS = [
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '0', label: MSG.topAll }
];
const BAR_COLORS = [
  '#f59e0b',
  '#ef4444',
  '#d4a5a5',
  '#9aa1ad',
  '#8b5cf6',
  '#10b981'
];
const LIVE_TICK_MS = 30_000;
const MS_PER_SECOND = 1000;

/** Pareto geometry (SVG user units). */
const W = 760;
const H = 300;
const PAD_L = 46;
const PAD_R = 46;
const PAD_T = 14;
const PAD_B = 96;
const MAX_BAR_W = 64;
const BAR_STEP_RATIO = 0.62;
const LABEL_MAX = 22;
const LABEL_ROTATION = 35;

export class MfWidgetDtAnalysis extends LitElement {
  static properties = {
    state: { attribute: false },
    cause: { attribute: false },
    stateMapping: { type: String },
    stateMappingId: { type: String },
    machineId: { type: String },
    stopCauses: { type: String },
    sTimeRange: { type: String },
    stopClass: { type: String },
    metric: { type: String },
    topN: { type: String },
    showKpis: { type: Boolean },
    showTable: { type: Boolean },
    showRangePicker: { type: Boolean },
    viewClass: { state: true },
    viewMetric: { state: true },
    viewTop: { state: true }
  };

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      color: var(--theme-color-std-text);
      font-family: var(--theme-font-family, inherit);
      font-size: 0.8rem;
      overflow: hidden;
    }
    .root {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      height: 100%;
      box-sizing: border-box;
      padding: 0.25rem;
      overflow: auto;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      min-height: 1.75rem;
    }
    .name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .grow {
      flex: 1 1 auto;
    }
    ix-select {
      min-width: 8rem;
      max-width: 11rem;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
      gap: 0.4rem;
    }
    .kpi {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      padding: 0.3rem 0.5rem;
      min-width: 0;
    }
    .kpi .v {
      font-size: 1.05rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpi .l {
      font-size: 0.68rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chart {
      flex: 1 1 auto;
      min-height: 7rem;
      width: 100%;
      display: block;
    }
    .chart text {
      font-family: inherit;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.75rem;
    }
    th,
    td {
      padding: 0.2rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: var(--theme-color-soft-text);
      font-weight: 500;
    }
    td.num,
    th.num {
      text-align: right;
    }
    td.cause {
      white-space: normal;
    }
    .muted {
      color: var(--theme-color-soft-text);
      padding: 0.25rem 0;
    }
  `;

  constructor() {
    super();
    this.state = undefined;
    this.cause = undefined;
    this.stateMapping = '';
    this.stateMappingId = '';
    this.machineId = '';
    this.stopCauses = '';
    this.sTimeRange = '';
    this.stopClass = 'unplanned';
    this.metric = 'downtime';
    this.topN = '5';
    this.showKpis = false;
    this.showTable = false;
    this.showRangePicker = false;
    this.viewClass = undefined;
    this.viewMetric = undefined;
    this.viewTop = undefined;
    this.liveTimer = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.liveTimer = globalThis.setInterval(() => {
      if (document.visibilityState !== 'hidden' && this.lastLive)
        this.requestUpdate();
    }, LIVE_TICK_MS);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.clearInterval(this.liveTimer);
  }

  /** The view controls: the session choice, else the widget setting, else the default. */
  get cls() {
    const v = this.viewClass ?? this.stopClass;
    return CLASS_OPTIONS.includes(v) ? v : 'unplanned';
  }

  get met() {
    const v = this.viewMetric ?? this.metric;
    return v === 'frequency' ? 'frequency' : 'downtime';
  }

  get top() {
    const n = Number(this.viewTop ?? this.topN);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  render() {
    const model = this.model();
    this.lastLive = model.live;
    return html`
      <div class="root">
        ${this.renderHead(model)}
        ${model.bound ? this.renderBody(model) : html`<div class="muted">${t(MSG.noBinding)}</div>`}
      </div>
    `;
  }

  model() {
    const stateSamples = toSamples(this.state?.value);
    const causeSamples = toSamples(this.cause?.value);
    const mapping = parseMapping(
      this.stateMapping,
      this.stateMappingId,
      this.machineId
    );
    const catalog = parseCatalog(this.stopCauses);
    const { start, end, live } = resolveWindow(this.sTimeRange, stateSamples);
    const analysis = analyseStops(
      stateSamples,
      causeSamples,
      mapping,
      catalog,
      start,
      end
    );
    const inClass = analysis.rows.filter((r) => r.classification === this.cls);
    const sorted = sortRows(
      inClass,
      this.met === 'downtime' ? 'downtime' : 'occurrences'
    );
    return {
      bound: this.state != undefined,
      name: typeof this.state?.name === 'string' ? this.state.name : '',
      hasHistory: stateSamples.length > 0,
      analysis,
      sorted,
      shown: this.top > 0 ? sorted.slice(0, this.top) : sorted,
      start,
      end,
      live
    };
  }

  renderHead(model) {
    return html`
      <div class="head">
        ${model.name ? html`<span class="name" title=${model.name}>${model.name}</span>` : nothing}
        <span class="grow"></span>
        <ix-select
          .value=${this.cls}
          @valueChange=${(event) => (this.viewClass = pick(event.detail))}
        >
          ${CLASS_OPTIONS.map((c) => html`<ix-select-item value=${c} label=${t(CLASS_LABELS[c])}></ix-select-item>`)}
        </ix-select>
        <ix-select
          .value=${this.met}
          @valueChange=${(event) => (this.viewMetric = pick(event.detail))}
        >
          ${METRIC_OPTIONS.map((o) => html`<ix-select-item value=${o.value} label=${t(o.label)}></ix-select-item>`)}
        </ix-select>
        <ix-select
          .value=${String(this.top)}
          @valueChange=${(event) => (this.viewTop = pick(event.detail))}
        >
          ${TOP_OPTIONS.map((o) => html`<ix-select-item value=${o.value} label=${t(o.label)}></ix-select-item>`)}
        </ix-select>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title=${t(MSG.exportCsv)}
          ?disabled=${model.sorted.length === 0}
          @click=${() => this.exportCsv(model)}
        ></ix-icon-button>
        ${this.renderRangeButton()}
      </div>
    `;
  }

  renderRangeButton() {
    if (!this.showRangePicker) return nothing;
    return html`
      <wui-datetime-range-button
        .value=${this.sTimeRange ?? ''}
        @wui:rangeselected=${this.onRangeSelected}
      ></wui-datetime-range-button>
    `;
  }

  renderBody(model) {
    if (!model.hasHistory)
      return html`<div class="muted">${t(MSG.noHistory)}</div>`;
    return html`
      ${this.showKpis ? this.renderKpis(model) : nothing}
      ${model.shown.length === 0 ? this.renderNoStops() : this.renderPareto(model)}
      ${this.showTable && model.sorted.length > 0 ? this.renderTable(model) : nothing}
    `;
  }

  renderNoStops() {
    const label = t(CLASS_LABELS[this.cls]).toLowerCase();
    const text = t(MSG.noStops).replace('{class}', label);
    return html`<div class="muted">${text}</div>`;
  }

  /**
   * KPI strip — the kpiCalc formulas on the covered window (no closures here):
   *   required = opening − planned;  availability = (required − unplanned) / required
   *   MTBF = (opening − unplanned) / N_failures;  MTTR = unplanned / N_failures
   * where a failure is a stop containing unplanned time.
   */
  renderKpis(model) {
    const { rows, stops, coveredMs } = model.analysis;
    const sum = (cls) =>
      rows
        .filter((r) => r.classification === cls)
        .reduce((s, r) => s + r.assignedMs, 0);
    const unplanned = sum('unplanned');
    const planned = sum('planned');
    const failures = stops.filter((s) =>
      s.classifications.includes('unplanned')
    ).length;
    const required = Math.max(0, coveredMs - planned);
    const availability =
      required > 0 ? (required - unplanned) / required : Number.NaN;
    const mtbf = failures > 0 ? (coveredMs - unplanned) / failures : Number.NaN;
    const mttr = failures > 0 ? unplanned / failures : Number.NaN;
    const kpi = (value, label, hint) => html`
      <div class="kpi">
        <div class="v" title=${value}>${value}</div>
        <div class="l" title=${hint ?? label}>${label}</div>
      </div>
    `;
    return html`
      <div class="kpis">
        ${kpi(formatPercent(availability), t(MSG.availability), `${formatDuration(coveredMs)} ${t(MSG.covered)}`)}
        ${kpi(formatDuration(unplanned), t(MSG.unplannedDowntime))}
        ${kpi(formatDuration(planned), t(MSG.plannedDowntime))}
        ${kpi(String(failures), t(MSG.failures))}
        ${kpi(Number.isFinite(mtbf) ? formatDuration(mtbf) : '—', MSG.mtbf)}
        ${kpi(Number.isFinite(mttr) ? formatDuration(mttr) : '—', MSG.mttr)}
      </div>
    `;
  }

  metricVal(r) {
    return this.met === 'downtime' ? r.downtimeMs : r.occurrences;
  }

  fmtMetric(v) {
    return this.met === 'downtime' ? formatDuration(v) : String(v);
  }

  /** A true Pareto: descending bars + cumulative-% line over ALL rows of the class. */
  renderPareto(model) {
    const rows = model.shown;
    const all = model.sorted;
    const x0 = PAD_L;
    const x1 = W - PAD_R;
    const y0 = PAD_T;
    const y1 = H - PAD_B;
    const plotH = y1 - y0;
    const step = (x1 - x0) / rows.length;
    const barW = Math.min(step * BAR_STEP_RATIO, MAX_BAR_W);
    const maxValue = Math.max(...rows.map((r) => this.metricVal(r)), 1);
    const totalAll = all.reduce((s, r) => s + this.metricVal(r), 0) || 1;
    const axis = 'var(--theme-color-soft-bdr)';
    const text = 'var(--theme-color-soft-text)';
    let cum = 0;
    const pts = rows.map((r, index) => {
      cum += this.metricVal(r);
      return {
        cx: x0 + (index + 0.5) * step,
        y: y1 - (cum / totalAll) * plotH,
        pct: (cum / totalAll) * 100
      };
    });
    const polyline = pts
      .map((p) => `${p.cx.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    return html`
      <svg
        class="chart"
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1=${x0} y1=${y0} x2=${x0} y2=${y1} stroke=${axis}></line>
        <line x1=${x1} y1=${y0} x2=${x1} y2=${y1} stroke=${axis}></line>
        <line x1=${x0} y1=${y1} x2=${x1} y2=${y1} stroke=${axis}></line>
        ${[0, 50, 100].map((p) => {
          const y = y1 - (p / 100) * plotH;
          return svg`<text x=${x1 + 6} y=${y + 3} fill=${text} font-size="11">${p}%</text>`;
        })}
        <text
          x=${x0 - 6}
          y=${y0 + 8}
          text-anchor="end"
          fill=${text}
          font-size="11"
        >
          ${this.fmtMetric(maxValue)}
        </text>
        ${rows.map((r, index) => {
          const v = this.metricVal(r);
          const h = (v / maxValue) * plotH;
          const cx = x0 + (index + 0.5) * step;
          return svg`<rect x=${cx - barW / 2} y=${y1 - h} width=${barW} height=${Math.max(h, 1)} rx="2"
              fill=${BAR_COLORS[index % BAR_COLORS.length]}><title>${r.label} — ${this.fmtMetric(v)}</title></rect>
            <text x=${cx} y=${y1 - h - 4} text-anchor="middle" fill=${text} font-size="10">${this.fmtMetric(v)}</text>
            <text x=${cx} y=${y1 + 12} transform="rotate(${LABEL_ROTATION} ${cx} ${y1 + 12})" fill=${text} font-size="10">${truncate(r.label, LABEL_MAX)}</text>`;
        })}
        <polyline
          points=${polyline}
          fill="none"
          stroke="var(--theme-color-primary)"
          stroke-width="2"
        ></polyline>
        ${pts.map((p) => svg`<circle cx=${p.cx} cy=${p.y} r="3" fill="var(--theme-color-primary)"><title>${p.pct.toFixed(1)} %</title></circle>`)}
      </svg>
    `;
  }

  renderTable(model) {
    const all = model.sorted;
    const totalAll = all.reduce((s, r) => s + this.metricVal(r), 0) || 1;
    let cum = 0;
    return html`
      <table>
        <thead>
          <tr>
            <th>${t(MSG.colCause)}</th>
            <th>${t(MSG.colClass)}</th>
            <th class="num">${t(MSG.colDowntime)}</th>
            <th class="num">${t(MSG.colOccurrences)}</th>
            <th class="num">${t(MSG.colCumul)}</th>
          </tr>
        </thead>
        <tbody>
          ${model.shown.map((r) => {
            cum += this.metricVal(r);
            return html`
              <tr>
                <td class="cause">${r.label}</td>
                <td>
                  ${t(CLASS_LABELS[r.classification] ?? r.classification)}
                </td>
                <td class="num">${formatDuration(r.downtimeMs)}</td>
                <td class="num">${r.occurrences}</td>
                <td class="num">${((cum / totalAll) * 100).toFixed(1)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  onRangeSelected = (event) => {
    const value = event.detail?.value;
    if (typeof value !== 'string' || value === '') return;
    this.sTimeRange = value;
    this.dispatchEvent(
      new CustomEvent('wui:changedaterange', {
        bubbles: true,
        composed: true,
        detail: {
          sTimeRange: value,
          tStartTime: undefined,
          tEndTime: undefined,
          live: true
        }
      })
    );
  };

  exportCsv(model) {
    const all = model.sorted;
    const totalAll = all.reduce((s, r) => s + this.metricVal(r), 0) || 1;
    const rows = [
      [
        t(MSG.colCause),
        t(MSG.colClass),
        t(MSG.colDowntimeSec),
        t(MSG.colDowntime),
        t(MSG.colOccurrences),
        t(MSG.colCumul)
      ]
    ];
    let cum = 0;
    for (const r of all) {
      cum += this.metricVal(r);
      rows.push([
        r.label,
        r.classification,
        String(Math.round(r.downtimeMs / MS_PER_SECOND)),
        formatDuration(r.downtimeMs),
        String(r.occurrences),
        ((cum / totalAll) * 100).toFixed(1)
      ]);
    }
    downloadCsv(`downtime_${fileSlug(model.name || this.machineId)}.csv`, rows);
  }
}

function pick(detail) {
  return Array.isArray(detail) ? detail[0] : detail;
}

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

if (!customElements.get('mf-widget-dt-analysis'))
  customElements.define('mf-widget-dt-analysis', MfWidgetDtAnalysis);
