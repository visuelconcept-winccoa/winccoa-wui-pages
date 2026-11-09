// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Default, hard-coded **machine dashboard** — a contextualised full-screen
 * overlay opened from a machine's detail card when it is NOT linked to a
 * specific WinCC OA dashboard. Four stacked bands (per the agreed design):
 *   - head   : machine identity + period bar (governs everything below);
 *   - top    : "Paramètres Process" — live parameters and computed KPIs as
 *              cards, each with a gauge when the value is numeric;
 *   - middle : the machine-state Gantt timeline;
 *   - bottom : "Suivi Alarmes" (half width) next to the stop-cause Pareto.
 *
 * Nothing is ever clipped: every band keeps a floor height, the two bottom
 * panels stack below 1100 px, and the whole content column scrolls rather than
 * squeezing a panel out of sight.
 *
 * Data is read live (`dpConnect` on the state, the stop cause and the bound
 * process parameters) and from the archived history (state timeline + Pareto),
 * reusing the fleet-stop-analysis engine. The panel stays live on its own: a
 * state or cause transition re-queries the history, and a slow tick keeps the
 * running segment and the ongoing downtime growing in between.
 * Rendered with plain SVG/DOM (no echarts) to stay light in this bundle.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription, firstValueFrom } from 'rxjs';
import { normDp } from '../data/dp-utils.js';
import {
  KPI_TYPE_INFO,
  TRS_WINDOW_LABELS,
  formatParamValue,
  formatStopCause,
  isRunningState,
  mappingStates as statesOf,
  resolveState,
  stateColor,
  stateLabel,
  type Machine,
  type MachineState,
  type StateMapping,
  type StopCause,
  type StopQualification
} from '../types.js';
import {
  analyseStopCauses,
  applyQualifications,
  qualificationAt,
  formatDuration,
  queryHistory,
  shortStopIntervals,
  sortRows,
  type AnalysisMachine,
  type CauseRow,
  type RawStop
} from '@visuelconcept-winccoa/wui-fleet-core/engine.js';
import {
  allowedSpans,
  clipToSpans,
  loadDashboardFilter,
  paretoFromStops,
  saveDashboardFilter,
  spanValues,
  valueSpans,
  type DashboardFilter,
  type ValueSpan
} from '@visuelconcept-winccoa/wui-fleet-core/dashboard-filter.js';
import '@visuelconcept-winccoa/wui-fleet-core/fleet-settings-service.js';
import { settingsCache } from '@visuelconcept-winccoa/wui-fleet-core/settings-cache.js';
import type { FleetFilter } from '@visuelconcept-winccoa/wui-fleet-core/filters.js';
import './mf-filter-bar.js';
import { scopeFromDpes } from '@visuelconcept-winccoa/wui-alarms-core/scope.js';
import '@visuelconcept-winccoa/wui-alarms-core/ui/wui-alarm-view.js';
import type { AlarmViewExtension } from '@visuelconcept-winccoa/wui-alarms-core/extensions.js';
import type { AlarmViewProfile } from '@visuelconcept-winccoa/wui-alarms-core/profile.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import {
  MSG,
  localize,
  localizeDir,
  ml,
  noStopOfClassMsg,
  rangeLabelMsg
} from '../i18n.js';
import { ganttTicks, tickLabel } from '../gantt-ticks.js';
import type { FleetStore } from '@visuelconcept-winccoa/wui-fleet-core/data/fleet-store.js';
import { currentAuditUser } from '@visuelconcept-winccoa/wui-kit/data/audit-trail.js';
import './mf-qualify-dialog.js';
import { dashboardParams } from '../dashboard-lines.js';

/**
 * The duration of each alarm in the dashboard's alarm panel: from its appearance to its
 * disappearance, or elapsed so far while it stands (SDS 2.2 SL-TDB-02). A column the alarm kit
 * draws through its extension point — the kit itself is not changed.
 */
const ALARM_DURATION_COLUMN = {
  id: 'duration',
  render: (a: { raised: number; cleared: number | null }) => formatDuration((a.cleared ?? Date.now()) - a.raised)
};
const ALARM_PROFILE: AlarmViewProfile = {
  panelColumns: ['raised', 'severity', 'text', { id: 'duration', label: MSG.machineDash.alarmDuration }, 'state']
};

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
  /** Its cause code ('' when none), and who gave it by hand (#272). */
  code?: string;
  qualifiedBy?: string;
}

/** A stop being given a cause by hand (#272). */
interface QualifyTarget {
  startMs: number;
  endMs: number;
  /** Cause as it stands: code, and label for display. */
  code: string;
  label: string;
}

type Period = 'today' | '24h' | '7d' | '30d' | 'week' | 'month' | 'custom';
const PERIOD_LABEL: Record<Period, MultiLangString> = {
  today: MSG.machineDash.periodToday,
  '24h': MSG.machineDash.period24h,
  '7d': MSG.machineDash.period7d,
  '30d': MSG.machineDash.period30d,
  week: MSG.machineDash.periodWeek,
  month: MSG.machineDash.periodMonth,
  custom: MSG.machineDash.periodCustom
};
const PERIODS = Object.keys(PERIOD_LABEL) as Period[];
const DAY_MS = 86_400_000;
/** A stop within this of an edge of the period shown is taken as cut by it (ms). */
const EDGE_MS = 1000;
const DATE_FORMAT = 'yyyy-MM-dd';
const END_OF_DAY_MS = DAY_MS - 1;

/** Pareto "show N causes" options (value 0 = all). */
const PARETO_TOP_OPTIONS: { value: string; label: MultiLangString }[] = [
  { value: '5', label: ml('Top 5', 'Top 5', 'Top 5') },
  { value: '10', label: ml('Top 10', 'Top 10', 'Top 10') },
  { value: '0', label: MSG.machineDash.paretoTopAll }
];
const DEFAULT_PARETO_TOP = 5;
/** Pareto metric: cumulated downtime vs. stop frequency (occurrences). */
type ParetoMetric = 'downtime' | 'frequency';
const PARETO_METRIC_OPTIONS: { value: ParetoMetric; label: MultiLangString }[] = [
  { value: 'downtime', label: MSG.machineDash.metricDowntime },
  { value: 'frequency', label: MSG.machineDash.metricFrequency }
];
/** Pareto stop-class filter: unplanned vs. planned stops. */
type ParetoClass = 'unplanned' | 'planned';
const PARETO_CLASS_OPTIONS: { value: ParetoClass; label: MultiLangString }[] = [
  { value: 'unplanned', label: MSG.machineDash.classOptUnplanned },
  { value: 'planned', label: MSG.machineDash.classOptPlanned }
];
/** Bar palette for the Pareto chart (cycled). */
const BAR_COLORS = ['#f59e0b', '#ef4444', '#d4a5a5', '#9aa1ad', '#8b5cf6', '#10b981'];
const DAYS_PER_WEEK = 7;
/** Debounce before re-querying the archived history after a live state/cause change. */
const HISTORY_RELOAD_DEBOUNCE_MS = 1500;
/** Cadence of the background refresh, while the window ends at "now". */
const LIVE_REFRESH_MS = 30_000;
/** Slack allowed when deciding whether the window still ends at "now". */
const LIVE_WINDOW_TOLERANCE_MS = 60_000;

/** Gauge geometry (SVG user units, viewBox 100 × 64): a 180° arc, centre (50,50), r 40. */
const GAUGE_ARC = 'M 10 50 A 40 40 0 0 1 90 50';
/** `pathLength` normalisation: the arc is exactly 100 units long, so the filled
 * portion is the percentage itself — no arc-length maths. */
const GAUGE_PATH_LENGTH = 100;
const PERCENT_MAX = 100;
/** Head-room above the highest observed value when a single value must scale the gauge. */
const GAUGE_SOLO_HEADROOM = 1.25;
/** Padding added on each side of an observed [min,max] band before rounding. */
const GAUGE_BAND_PADDING = 0.1;
/** "Nice" scale ceilings (× 10^k) used to round a gauge bound outwards. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
/** Above this magnitude a displayed value drops its decimals. */
const COMPACT_VALUE_THRESHOLD = 1000;
const VALUE_DECIMALS = 2;

/** One card of the parameter band: a live value, its unit and how to scale it. */
interface ParamCard {
  key: string;
  label: string;
  value: number | string | undefined;
  unit: string;
  /** Gauge colour override (TRS threshold band); default = the theme primary. */
  color?: string;
  /** Small muted footer (e.g. the KPI's sliding window). */
  hint?: string;
  /** Configured decimals of a process parameter (unset = the shared default rule). */
  decimals?: number;
}

@customElement('mf-machine-dashboard')
export class MfMachineDashboard extends LitElement {
  static override readonly styles = [IXCoreStyles, dashboardStyles()];

  @property({ attribute: false }) machine!: Machine;
  @property({ attribute: false }) mapping: StateMapping | undefined;
  @property({ attribute: false }) stopCauses: StopCause[] = [];
  @property({ attribute: false }) api: OaRxJsApi | null = null;
  @property() atelierId = '';
  @property() atelierName = '';
  /** Store of the causes given by hand (null: read-only). */
  @property({ attribute: false }) store: FleetStore | null = null;
  /** May give a cause to a stop (canPublish + the 'qualify' role, #272). */
  @property({ type: Boolean }) canQualify = false;
  /** This machine's causes given by hand, laid over its cause history. */
  @state() private qualifications: StopQualification[] = [];
  /** The period last analysed (ms): a stop touching its edges is not given a cause. */
  private windowMs = { start: 0, end: 0 };
  @state() private qualifying: QualifyTarget | null = null;
  @state() private qualifyError = false;

  @state() private period: Period = '7d';
  /** How far back the window is shifted from "now" (ms); 0 = current period. */
  @state() private offsetMs = 0;
  @state() private customStart = '';
  @state() private customEnd = '';
  @state() private paretoTop = DEFAULT_PARETO_TOP;
  @state() private paretoMetric: ParetoMetric = 'downtime';
  @state() private paretoClass: ParetoClass = 'unplanned';
  @state() private segmentsAll: StateSegment[] = [];
  /** Full sorted (desc) list of unplanned causes; sliced per `paretoTop` at render. */
  @state() private paretoAll: CauseRow[] = [];
  /** Stops of the period, most recent first, split by cause (SL-TDB-04). */
  @state() private stopsAll: RawStop[] = [];
  /** Dashboard filters (SL-TDB-05), remembered in the browser; context = work order and filterable params. */
  @state() private filter: DashboardFilter = loadDashboardFilter();
  @state() private contextDims: { key: string; label: string; spans: ValueSpan[] }[] = [];
  /** Alarm types (alert-class abbreviations) seen on this machine's alarms — the type filter's choices. */
  @state() private alarmTypes: string[] = [];
  /** Duration column, and the alarm types noted as the rows come (the kit's extension point). */
  private readonly alarmExtension: AlarmViewExtension = {
    id: 'machine-fleet-dashboard',
    columns: [ALARM_DURATION_COLUMN],
    classify: (alarm) => {
      if (alarm.abbr !== '' && !this.alarmTypes.includes(alarm.abbr)) {
        queueMicrotask(() => {
          if (!this.alarmTypes.includes(alarm.abbr)) this.alarmTypes = [...this.alarmTypes, alarm.abbr].sort();
        });
      }
      return alarm;
    }
  };
  @state() private loading = false;
  @state() private tip: { x: number; y: number; seg: StateSegment } | null = null;
  /** Live DP values from `dpConnect`, keyed by normalised DP name. */
  @state() private liveValues: Record<string, unknown> = {};

  private dpSub = new Subscription();
  private settingsSub: Subscription | null = null;
  /** Normalised state-DP name (to detect state changes in the live stream). */
  private stateKey = '';
  /** Normalised stop-cause-DP name (a cause assignment re-classifies a stop). */
  private causeKey = '';
  /** Last state/cause seen live — a rewrite of the same value is not a transition. */
  private lastState = '';
  private lastCause = '';
  private historyDebounce = 0;
  private liveTimer = 0;
  /** Generation of the running history query — a superseded one must not land. */
  private reloadGen = 0;
  /** Observed [min,max] per card key — the gauge scale of the values seen so far. */
  private readonly observed = new Map<string, { min: number; max: number }>();

  override render(): TemplateResult {
    const m = this.machine;
    return html`
      <div class="overlay">
        <div class="panel">
          <div class="panel-head">
            <span class="dot" style="background:${stateColor(this.mapping, this.liveState())}"></span>
            <ix-typography format="h3">${m.name}</ix-typography>
            <ix-chip outline>${m.loc ?? m.type}</ix-chip>
            <span class="grow"></span>
            ${m.ownerLink?.url
              ? html`<ix-button variant="secondary" @click=${() => window.location.assign(m.ownerLink?.url ?? '')}
                  >${m.ownerLink.label}</ix-button
                >`
              : ''}
            <ix-icon-button ghost icon="close" title=${localize(MSG.machineDash.close)} @click=${this.close}></ix-icon-button>
          </div>
          ${this.renderToolbar()} ${this.renderFilters()}
          <div class="content">
            <section class="zone zone-params">
              <h4>${localizeDir(MSG.machineDash.processParams)}</h4>
              ${this.renderParams()}
            </section>
            <section class="zone zone-gantt">${this.renderGantt()}</section>
            <div class="bottom-row">
              <section class="zone zone-alarms">
                <h4>${localizeDir(MSG.machineDash.alarmTracking)}</h4>
                ${this.renderAlarms()}
              </section>
              <section class="zone zone-pareto">${this.renderPareto()}</section>
            </div>
            <section class="zone zone-stops">${this.renderStops()}</section>
          </div>
        </div>
      </div>
      ${this.renderTip()} ${this.renderQualify()}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The panel covers the whole viewport, so there is no backdrop left to click:
    // Escape is the way out besides the close button.
    window.addEventListener('keydown', this.onKeyDown);
    // The filter is the user's (their settings), read again on every login.
    this.settingsSub = settingsCache.watch(['fleet-dashboard'], () => (this.filter = loadDashboardFilter()));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKeyDown);
    this.settingsSub?.unsubscribe();
    this.settingsSub = null;
    this.dpSub.unsubscribe();
    window.clearTimeout(this.historyDebounce);
    window.clearInterval(this.liveTimer);
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.init();
    this.startLiveRefresh();
  }

  /**
   * Open the panel on the data as it stands NOW.
   *
   * The order matters: the live values are read (and the DP list validated)
   * first, then the history is queried ONCE. The first paint must never depend
   * on the next state transition to arrive — the machine may well sit in the
   * same state for minutes — and going through the live seed first means the
   * history query is issued on a channel that has just demonstrably answered.
   * From there on only a real state/cause change, or the slow tick, re-queries.
   */
  private async init(): Promise<void> {
    this.loading = true;
    await this.connectLive();
    await this.reload();
  }

  /**
   * Subscribe to the machine's live DPs — **state**, **stop cause** and the bound
   * process parameters — via `dpConnect`, the same mechanism as the 3D view.
   *
   * Parameters render reactively off the stream; a **state** transition redraws
   * the Gantt and a **cause** assignment re-classifies the stop it belongs to
   * (Gantt bubble AND Pareto), so both re-query the archived history.
   */
  private async connectLive(): Promise<void> {
    const api = this.api;
    const m = this.machine;
    if (!api) return;
    this.stateKey = m.stateDp ? normDp(m.stateDp) : '';
    this.causeKey = m.stopCauseDp ? normDp(m.stopCauseDp) : '';
    const dps = [
      ...new Set(
        [m.stateDp, m.stopCauseDp, m.workOrderDp, m.operationDp, ...(m.kpis ?? []).map((k) => k.dp)].filter(
          (d): d is string => typeof d === 'string' && d !== ''
        )
      )
    ];
    if (dps.length === 0) return;
    await this.connectValidDps(api, dps);
  }

  /**
   * Validate the candidates with a one-shot `dpGet` (which doubles as the initial
   * value seed), then open a single `dpConnect` block over the survivors.
   *
   * `dpConnect` fails as a BLOCK: one stale binding — a parameter DP left behind
   * by a renamed machine, say — would take the state and cause down with it and
   * silently freeze the Gantt. Same reasoning as the 3D view's `connectValidDps`.
   */
  private async connectValidDps(api: OaRxJsApi, dps: string[]): Promise<void> {
    const results = await Promise.allSettled(dps.map((dp) => firstValueFrom(api.dpGet(dp))));
    const live: Record<string, unknown> = { ...this.liveValues };
    const valid: string[] = [];
    for (const [i, dp] of dps.entries()) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue; // missing / unreadable → exclude
      valid.push(dp);
      live[normDp(dp)] = result.value;
    }
    this.liveValues = live;
    // The seeds ARE the values the initial load draws: recording them here is what
    // makes the opening `dpConnect` answer a non-event (see `onLive`).
    this.lastState = this.liveText(this.stateKey);
    this.lastCause = this.liveText(this.causeKey);
    if (valid.length === 0) return;
    try {
      // Added to the block subscription: if the panel closed while the values
      // were being validated, the new subscription is torn down at once.
      this.dpSub.add(
        api.dpConnect(valid, true).subscribe({
          next: (e: { dp: string[]; value: unknown[] }) => this.onLive(e),
          error: () => this.requestUpdate() // live channel dropped — keep the seeds
        })
      );
    } catch {
      // Backend not connected — params fall back to their static values.
    }
  }

  /**
   * Fold a live emission into the rendered values, and re-query the history when
   * the timeline actually moved.
   *
   * Only a CHANGE of state or cause counts: `dpConnect(…, true)` opens with an
   * answer carrying the current values (already drawn by the initial load), and
   * the simulator rewrites both every 30 s whether they moved or not — neither is
   * a transition, and neither is worth a pair of archive queries.
   */
  private onLive(e: { dp: string[]; value: unknown[] }): void {
    const live: Record<string, unknown> = { ...this.liveValues };
    for (const [i, name] of e.dp.entries()) live[normDp(name)] = e.value[i];
    this.liveValues = live;
    const state = this.liveText(this.stateKey);
    const cause = this.liveText(this.causeKey);
    if (state === this.lastState && cause === this.lastCause) return;
    this.lastState = state;
    this.lastCause = cause;
    this.scheduleReload();
  }

  /** A live value in comparable form (arrays unwrapped, absent = empty). */
  private liveText(key: string): string {
    if (key === '') return '';
    const raw = extractScalar(this.liveValues[key]);
    return raw == null ? '' : String(raw);
  }

  /** Coalesce the re-queries a burst of live changes would otherwise trigger. */
  private scheduleReload(): void {
    window.clearTimeout(this.historyDebounce);
    this.historyDebounce = window.setTimeout(
      () => void this.reload(true),
      HISTORY_RELOAD_DEBOUNCE_MS
    );
  }

  /**
   * Slow background refresh, only while the window ends at "now".
   *
   * The transition-driven reload above covers the instant a state or a cause
   * changes, but it cannot make the *running* segment grow, and an ongoing stop
   * keeps accumulating downtime in the Pareto while nothing changes at all. The
   * tick keeps both honest; it stands down on a past window (nothing moves
   * there) and on a hidden tab, so it never polls the archive for nobody.
   */
  private startLiveRefresh(): void {
    this.liveTimer = window.setInterval(() => {
      if (this.loading || document.visibilityState === 'hidden' || !this.isLiveWindow()) return;
      void this.reload(true);
    }, LIVE_REFRESH_MS);
  }

  /** True when the selected window still ends at "now". */
  private isLiveWindow(): boolean {
    if (this.offsetMs !== 0) return false;
    return this.resolveRange().end.getTime() >= Date.now() - LIVE_WINDOW_TOLERANCE_MS;
  }

  /**
   * The machine's alarms — the SHARED alarm view, in its panel form.
   *
   * Same component as the `/alarms` page: the tabs inside it switch between the
   * standing alarms and the archived ones, and the archived ones use THIS
   * dashboard's period (the toolbar above governs the whole right side), which is
   * why the view's own period controls are hidden. `strict-scope` matters: a
   * machine with no bound datapoint must show nothing, never the whole plant.
   */
  private renderAlarms(): TemplateResult {
    const { start, end } = this.resolveRange();
    return html`
      <wui-alarm-view
        layout="panel"
        hide-period
        strict-scope
        .from=${start.getTime()}
        .to=${end.getTime()}
        .scope=${this.alarmScope()}
        .profile=${ALARM_PROFILE}
        .extensions=${[this.alarmExtension]}
        .filters=${{ classes: this.filter.alarmTypes ?? [] }}
      ></wui-alarm-view>
    `;
  }

  /**
   * Alarm scope of the machine: its bound DATAPOINTS, not their elements.
   *
   * An alarm may sit on any element of a datapoint the machine binds, including
   * ones this dashboard does not read — so scoping on the datapoints is the
   * useful reading of "this machine's alarms".
   */
  private alarmScope(): readonly string[] {
    const m = this.machine;
    return scopeFromDpes([
      m.stateDp,
      m.commDp,
      m.stopCauseDp,
      m.workOrderDp,
      m.operationDp,
      ...(m.kpis ?? []).map((k) => k.dp),
      ...(m.alarmDps ?? [])
    ]);
  }

  /** Period filter governing the whole right side (Suivi Alarmes + KPI). */
  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-icon-button
          ghost
          icon="chevron-left"
          title=${localize(MSG.machineDash.prevPeriod)}
          @click=${() => this.shiftPeriod(1)}
        ></ix-icon-button>
        <label class="ctl">
          <span>${localizeDir(MSG.machineDash.period)}</span>
          <ix-select
            .value=${this.period}
            @valueChange=${(e: CustomEvent<string | string[]>) => this.onPeriod(e.detail)}
          >
            ${PERIODS.map(
              (p) => html`<ix-select-item value=${p} label=${localize(PERIOD_LABEL[p])}></ix-select-item>`
            )}
          </ix-select>
        </label>
        <ix-icon-button
          ghost
          icon="chevron-right"
          title=${localize(MSG.machineDash.nextPeriod)}
          ?disabled=${this.offsetMs === 0}
          @click=${() => this.shiftPeriod(-1)}
        ></ix-icon-button>
        ${this.period === 'custom'
          ? html`
              <label class="ctl">
                <span>${localizeDir(MSG.machineDash.start)}</span>
                <ix-date-input
                  format=${DATE_FORMAT}
                  .value=${this.customStart}
                  @valueChange=${(e: CustomEvent<string>) => this.onCustomDate('start', e.detail)}
                ></ix-date-input>
              </label>
              <label class="ctl">
                <span>${localizeDir(MSG.machineDash.end)}</span>
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

  // --- dashboard filters (SL-TDB-05) --------------------------------------------

  /** Work order and the parameters marked filterable, each as value spans over the period. */
  private async buildContext(m: Machine, start: Date, end: Date): Promise<{ key: string; label: string; spans: ValueSpan[] }[]> {
    const lookback = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const dims: { key: string; label: string; dp: string }[] = [];
    if (m.workOrderDp) dims.push({ key: 'of', label: localize(MSG.machineDash.filterWorkOrder), dp: m.workOrderDp });
    for (const k of m.kpis ?? []) if (k.filterable && k.dp) dims.push({ key: `param:${k.key}`, label: k.label || k.key, dp: k.dp });
    const out: { key: string; label: string; spans: ValueSpan[] }[] = [];
    for (const d of dims) {
      // eslint-disable-next-line no-await-in-loop
      const samples = await queryHistory(this.api, d.dp, lookback, end);
      out.push({ key: d.key, label: d.label, spans: valueSpans(samples, start.getTime(), end.getTime()) });
    }
    return out;
  }

  /** Periods the context selection keeps (null = no context filter). */
  private allowed(): { s: number; e: number }[] | null {
    const dims = Object.fromEntries(this.contextDims.map((d) => [d.key, d.spans]));
    const selected: Record<string, string[]> = {};
    for (const d of this.contextDims) {
      const values = (this.filter.context[d.key] ?? []).filter((v) => d.spans.some((x) => x.v === v));
      if (values.length) selected[d.key] = values;
    }
    return allowedSpans(dims, selected);
  }

  private filterActive(): boolean {
    return this.allowed() !== null || this.filter.states.length > 0 || this.filter.causes.length > 0;
  }

  /** State of the machine when a stop started (from the unfiltered timeline). */
  private stateAt(t: number): string {
    return this.segmentsAll.find((s) => t >= s.startMs && t < s.endMs)?.state ?? '';
  }

  /** The Gantt segments within the kept periods. */
  private get segments(): StateSegment[] {
    return clipToSpans(this.segmentsAll, this.allowed());
  }

  /** The stops within the kept periods, of the selected states and causes. */
  private get stops(): RawStop[] {
    const { states, causes } = this.filter;
    return clipToSpans(this.stopsAll, this.allowed()).filter(
      (s) => (states.length === 0 || states.includes(this.stateAt(s.startMs))) && (causes.length === 0 || causes.includes(s.causeKey))
    );
  }

  /** Pareto rows: the analysis' own without filter, else recomputed from the filtered stops. */
  private get pareto(): CauseRow[] {
    if (!this.filterActive()) return this.paretoAll;
    return paretoFromStops(this.stops).filter((r) => r.classification === 'unplanned' || r.classification === 'planned');
  }

  /** Filter bar: state, stop cause, then the context dimensions (labels shown, keys kept). */
  private renderFilters(): TemplateResult {
    const stateLabels = new Map(statesOf(this.mapping).map((s) => [s.key, s.label]));
    const causeLabels = new Map(this.stopsAll.map((s) => [s.causeKey, s.causeLabel]));
    const dims = [
      { key: localize(MSG.machineDash.filterState), values: [...stateLabels.values()] },
      { key: localize(MSG.machineDash.filterCause), values: [...new Set(causeLabels.values())].sort() },
      ...this.contextDims.map((d) => ({ key: d.label, values: spanValues(d.spans) })),
      {
        key: localize(MSG.machineDash.filterAlarmType),
        values: [...new Set([...this.alarmTypes, ...(this.filter.alarmTypes ?? [])])].sort()
      }
    ].filter((d) => d.values.length > 0);
    const selected: FleetFilter = {
      [localize(MSG.machineDash.filterState)]: this.filter.states.map((k) => stateLabels.get(k) ?? k),
      [localize(MSG.machineDash.filterCause)]: this.filter.causes.map((k) => causeLabels.get(k) ?? k)
    };
    for (const d of this.contextDims) selected[d.label] = this.filter.context[d.key] ?? [];
    selected[localize(MSG.machineDash.filterAlarmType)] = this.filter.alarmTypes ?? [];
    const onFilter = (e: CustomEvent<FleetFilter>): void => {
      const f = e.detail;
      const back = (labels: Map<string, string>, chosen: string[] | undefined): string[] =>
        [...labels].filter(([, label]) => (chosen ?? []).includes(label)).map(([key]) => key);
      const context: Record<string, string[]> = {};
      for (const d of this.contextDims) if (f[d.label]?.length) context[d.key] = f[d.label];
      this.filter = {
        states: back(stateLabels, f[localize(MSG.machineDash.filterState)]),
        causes: back(causeLabels, f[localize(MSG.machineDash.filterCause)]),
        context,
        alarmTypes: f[localize(MSG.machineDash.filterAlarmType)] ?? []
      };
      saveDashboardFilter(this.filter);
    };
    return html`<mf-filter-bar class="dash-filters" .dimensions=${dims} .filter=${selected} @wui:filter=${onFilter}></mf-filter-bar>`;
  }

  /** "du <début> au <fin>" for the resolved period — always shown. */
  private rangeLabel(): string {
    const { start, end } = this.resolveRange();
    return rangeLabelMsg(formatDateTime(start.getTime()), formatDateTime(end.getTime()));
  }

  /**
   * Top band: the context line (production context, identities, work order and
   * operation), then one card per process parameter and per computed KPI.
   */
  private renderParams(): TemplateResult {
    const context = this.contextItems();
    const cards = this.paramCards();
    return html`
      ${context.length
        ? html`<div class="context">
            ${context.map(
              (c) => html`<span class="ctx-item"
                ><span class="ctx-label">${c.label}</span
                ><span class="ctx-value" title=${c.value}>${c.value}</span></span
              >`
            )}
          </div>`
        : ''}
      ${cards.length === 0
        ? html`<div class="muted">${localizeDir(MSG.machineDash.noProcessParams)}</div>`
        : html`<div class="cards">${cards.map((c) => this.renderCard(c))}</div>`}
    `;
  }

  /** A live value as text, '—' when empty. */
  private liveDisplay(dp: string | undefined, fallback?: number | string, decimals?: number): string {
    const live = dp ? extractScalar(this.liveValues[normDp(dp)]) : undefined;
    const v = live ?? fallback;
    if (v == null || v === '') return '—';
    return typeof v === 'number' ? formatParamValue(v, decimals) : String(v);
  }

  /**
   * The context line, outside the process parameters' cap: the context parameters
   * (article, contract, identities…), then the work order and the operation.
   */
  private contextItems(): { label: string; value: string }[] {
    const m = this.machine;
    const items = dashboardParams(m).context.map((k) => ({
      label: k.label || k.key,
      value: this.liveDisplay(k.dp, k.value, k.decimals)
    }));
    if (m.workOrderDp) items.push({ label: localize(MSG.view.workOrder), value: this.liveDisplay(m.workOrderDp) });
    if (m.operationDp) items.push({ label: localize(MSG.view.operation), value: this.liveDisplay(m.operationDp) });
    return items;
  }

  /**
   * The cards of the top band: the process parameters ticked for the machine's
   * popup, at most MAX_SHOWN (live via `dpConnect`), followed by the KPIs the
   * `kpiCalc` manager computes. The KPI values are read straight off the live
   * machine object the 3D view keeps updated — they refresh with the next render,
   * driven by the parameter stream.
   */
  private paramCards(): ParamCard[] {
    const m = this.machine;
    const cards: ParamCard[] = dashboardParams(m).process.map((k) => {
      // Prefer the live dpConnect value; fall back to the last known value.
      const live = k.dp ? extractScalar(this.liveValues[normDp(k.dp)]) : undefined;
      // Where the value comes from (automatic, manual…), when the integration tells it.
      return { key: `param:${k.key}`, label: k.label || k.key, value: live ?? k.value, unit: k.unit ?? '', hint: k.source, decimals: k.decimals };
    });
    for (const kpi of m.kpiCalcs ?? []) {
      const info = KPI_TYPE_INFO[kpi.type];
      cards.push({
        key: `kpi:${kpi.id}`,
        label: kpi.label && kpi.label !== '' ? kpi.label : info.label,
        value: (m.kpiCalcValues ?? {})[kpi.id],
        unit: info.unit,
        color: (m.kpiCalcColors ?? {})[kpi.id],
        hint: TRS_WINDOW_LABELS[kpi.window]
      });
    }
    return cards;
  }

  /** A parameter card: gauge + value when numeric, plain value otherwise. */
  private renderCard(card: ParamCard): TemplateResult {
    const num = typeof card.value === 'number' ? card.value : Number.NaN;
    const numeric = Number.isFinite(num);
    return html`
      <ix-card class="card">
        <ix-card-content>
          <div class="card-label" title=${card.label}>${card.label}</div>
          ${numeric
            ? this.renderGauge(card, num)
            : html`<div class="card-text" title=${String(card.value ?? '')}>
                ${card.value == null || card.value === '' ? '—' : card.value}
              </div>`}
          ${card.hint ? html`<div class="card-hint">${card.hint}</div>` : ''}
        </ix-card-content>
      </ix-card>
    `;
  }

  /**
   * Radial gauge for one numeric parameter.
   *
   * Nothing in the fleet model carries an engineering range, so the scale is
   * derived: a percentage reads 0–100, anything else is scaled from the values
   * SEEN so far (widened, never narrowed, as the value moves) and rounded
   * outwards to a readable bound. Both bounds are printed under the arc so the
   * scale the operator is reading is never implicit.
   */
  private renderGauge(card: ParamCard, value: number): TemplateResult {
    const { min, max } = this.gaugeScale(card, value);
    const ratio = (value - min) / (max - min || 1);
    const pct = Math.min(Math.max(ratio, 0), 1) * PERCENT_MAX;
    const color = card.color ?? 'var(--theme-color-primary)';
    return html`
      <svg class="gauge-svg" viewBox="0 0 100 64" role="img" aria-label=${`${card.label} ${formatCardValue(value, card.decimals)} ${card.unit}`}>
        <path class="gauge-track" d=${GAUGE_ARC} pathLength=${GAUGE_PATH_LENGTH}></path>
        <path
          class="gauge-fill"
          d=${GAUGE_ARC}
          pathLength=${GAUGE_PATH_LENGTH}
          stroke=${color}
          stroke-dasharray=${`${pct.toFixed(1)} ${GAUGE_PATH_LENGTH}`}
        ></path>
        <text class="gauge-value" x="50" y="46" text-anchor="middle">${formatCardValue(value, card.decimals)}</text>
        ${card.unit ? svg`<text class="gauge-unit" x="50" y="58" text-anchor="middle">${card.unit}</text>` : ''}
        <text class="gauge-bound" x="8" y="62">${formatValue(min)}</text>
        <text class="gauge-bound" x="92" y="62" text-anchor="end">${formatValue(max)}</text>
      </svg>
    `;
  }

  /**
   * Gauge bounds for a card. Percentages are absolute (0–100); everything else
   * tracks the observed extremes of the session in `observed` — a plain Map, not
   * reactive state, so widening it during a render cannot loop.
   */
  private gaugeScale(card: ParamCard, value: number): { min: number; max: number } {
    if (card.unit.trim() === '%') return { min: 0, max: PERCENT_MAX };
    const seen = this.observed.get(card.key);
    const band = seen
      ? { min: Math.min(seen.min, value), max: Math.max(seen.max, value) }
      : { min: value, max: value };
    this.observed.set(card.key, band);
    return niceScale(band.min, band.max);
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
        <div class="block-title">${localizeDir(MSG.machineDash.ganttTitle)}</div>
        <span class="grow"></span>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title=${localize(MSG.machineDash.exportGanttCsv)}
          ?disabled=${segs.length === 0}
          @click=${this.exportGanttCsv}
        ></ix-icon-button>
      </div>
    `;
    if (this.loading) return html`${head}<div class="center"><ix-spinner></ix-spinner></div>`;
    if (segs.length === 0) {
      return html`${head}<div class="muted small">${localizeDir(MSG.machineDash.noHistory)}</div>`;
    }
    const start = segs[0].startMs;
    const total = segs.at(-1)!.endMs - start || 1;
    // Dates of the start, the end and the state changes, readable without hovering (#279).
    const ticks = ganttTicks([...segs.map((s) => s.startMs), segs.at(-1)!.endMs]);
    return html`
      ${head}
      <svg class="gantt" viewBox="0 0 100 10" preserveAspectRatio="none">
        ${segs.map((s) => {
          const x = ((s.startMs - start) / total) * 100;
          const w = ((s.endMs - s.startMs) / total) * 100;
          return svg`<rect x=${x} y="0" width=${Math.max(w, 0.2)} height="10"
            fill=${stateColor(this.mapping, s.state)}
            @pointermove=${(e: PointerEvent) => this.showTip(e, s)}
            @pointerleave=${() => (this.tip = null)}
            @click=${() => this.qualifySegment(s)}></rect>`;
        })}
        ${ticks
          .filter((t) => t.align === 'middle')
          .map((t) => svg`<line class="gantt-mark" x1=${t.pct} x2=${t.pct} y1="0" y2="10"></line>`)}
      </svg>
      <div class="gantt-axis">
        ${ticks.map(
          (t) => html`<span class="tick tick--${t.align}" style="left:${t.pct}%">${tickLabel(t.ms, total)}</span>`
        )}
      </div>
      <div class="legend">
        ${this.mappingStates().map(
          (st) => html`<span class="leg"
            ><i style="background:${stateColor(this.mapping, st)}"></i>${stateLabel(this.mapping, st)}</span
          >`
        )}
      </div>
    `;
  }

  private readonly exportGanttCsv = (): void => {
    const rows: string[][] = [
      [
        localize(MSG.machineDash.csvStart),
        localize(MSG.machineDash.csvEnd),
        localize(MSG.machineDash.csvState),
        localize(MSG.machineDash.csvStopCause)
      ]
    ];
    for (const s of this.segments) {
      rows.push([
        formatDateTimeSec(s.startMs),
        formatDateTimeSec(s.endMs),
        stateLabel(this.mapping, s.state),
        s.causeLabel ?? ''
      ]);
    }
    downloadCsv(`gantt_${this.machine.id}.csv`, rows);
  };

  /**
   * Hover bubble for a Gantt segment: start/end, state and any stop cause.
   *
   * Timestamped **to the second**, like the CSV export: a state can flip within
   * the same minute, and at minute precision two adjacent segments read as
   * starting and ending at the very same instant.
   */
  private renderTip(): TemplateResult {
    const tip = this.tip;
    if (!tip) return html``;
    const s = tip.seg;
    return html`
      <div class="gantt-tip" style="left:${tip.x}px;top:${tip.y}px">
        <div class="tip-state" style="color:${stateColor(this.mapping, s.state)}">${stateLabel(this.mapping, s.state)}</div>
        <div>${localizeDir(MSG.machineDash.tipStart)} ${formatDateTimeSec(s.startMs)}</div>
        <div>${localizeDir(MSG.machineDash.tipEnd)} ${formatDateTimeSec(s.endMs)}</div>
        <div>${localizeDir(MSG.machineDash.tipDuration)} ${formatDuration(s.endMs - s.startMs)}</div>
        ${s.causeLabel ? html`<div>${localizeDir(MSG.machineDash.tipCause)} ${s.causeLabel}</div>` : ''}
        ${s.qualifiedBy ? html`<div class="muted">${localizeDir(MSG.qualify.givenBy)} ${s.qualifiedBy}</div>` : ''}
        ${this.canQualifySegment(s) ? html`<div class="muted">${localizeDir(MSG.qualify.clickHint)}</div>` : ''}
      </div>
    `;
  }

  private showTip(e: PointerEvent, seg: StateSegment): void {
    this.tip = { x: e.clientX, y: e.clientY, seg };
  }

  /** States produced by the machine's state mapping (rules + fallback), in the
   * mapping's display order — so the Gantt legend conforms to that machine's mapping. */
  private mappingStates(): MachineState[] {
    const all = statesOf(this.mapping).map((s) => s.key);
    const mp = this.mapping;
    if (!mp) return all;
    const present = new Set<MachineState>(mp.rules.map((r) => r.state));
    present.add(mp.fallback);
    return all.filter((s) => present.has(s));
  }

  /**
   * Downtime of a cause: the time it was the active cause of a stop (assigned time), so a stop
   * shared by several causes is split between them and counted once; a single cause takes the
   * whole stop (it is back-filled to the stop's start).
   */
  private metricVal(r: CauseRow): number {
    return this.paretoMetric === 'downtime' ? r.assignedMs : r.occurrences;
  }

  /** List of the stops of the period, by cause (SL-TDB-04). */
  private renderStops(): TemplateResult {
    const shown = this.stops;
    const head = html`
      <div class="block-head">
        <div class="block-title">${localizeDir(MSG.machineDash.stopsTitle)}</div>
        <span class="muted small">${this.stops.length}</span>
        <span class="grow"></span>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title=${localize(MSG.machineDash.exportStopsCsv)}
          ?disabled=${shown.length === 0}
          @click=${this.exportStopsCsv}
        ></ix-icon-button>
      </div>
    `;
    if (this.loading) return html`${head}<div class="center"><ix-spinner></ix-spinner></div>`;
    if (shown.length === 0) return html`${head}<div class="muted small">${localizeDir(MSG.machineDash.stopsNone)}</div>`;
    return html`${head}
      ${this.qualifyError ? html`<div class="small qualify-error">${localizeDir(MSG.qualify.failed)}</div>` : ''}
      <div class="stops-scroll">
        <table class="stops">
          <thead>
            <tr>
              <th>${localizeDir(MSG.machineDash.stopsStart)}</th>
              <th>${localizeDir(MSG.machineDash.stopsEnd)}</th>
              <th class="num">${localizeDir(MSG.machineDash.stopsDuration)}</th>
              <th>${localizeDir(MSG.machineDash.stopsCause)}</th>
              <th>${localizeDir(MSG.machineDash.stopsClass)}</th>
              ${this.canQualify ? html`<th></th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (s) => html`<tr>
                <td>${formatDateTime(s.startMs)}</td>
                <td>${formatDateTime(s.endMs)}</td>
                <td class="num">${formatDuration(s.durationMs)}</td>
                <td>
                  ${s.code !== '' ? s.causeLabel : '—'}
                  ${s.qualifiedBy ? html`<span class="muted small" title=${localize(MSG.qualify.givenBy)}> · ${s.qualifiedBy}</span>` : ''}
                </td>
                <td>${stopClassLabel(s.classification)}</td>
                ${this.canQualify
                  ? html`<td>
                      <ix-icon-button
                        ghost
                        size="16"
                        icon="pen"
                        title=${this.qualifiable(s.startMs, s.endMs) ? localize(MSG.qualify.title) : localize(MSG.qualify.notWhole)}
                        ?disabled=${!this.qualifiable(s.startMs, s.endMs)}
                        @click=${() => this.openQualify({ startMs: s.startMs, endMs: s.endMs, code: s.code, label: s.code !== '' ? s.causeLabel : '' })}
                      ></ix-icon-button>
                    </td>`
                  : ''}
              </tr>`
            )}
          </tbody>
        </table>
      </div>`;
  }

  private readonly exportStopsCsv = (): void => {
    const rows: string[][] = [
      [
        localize(MSG.machineDash.stopsStart),
        localize(MSG.machineDash.stopsEnd),
        localize(MSG.machineDash.csvDowntimeSec),
        localize(MSG.machineDash.stopsCause),
        localize(MSG.machineDash.stopsClass)
      ]
    ];
    for (const s of this.stops) {
      rows.push([
        formatDateTime(s.startMs),
        formatDateTime(s.endMs),
        String(Math.round(s.durationMs / 1000)),
        s.code !== '' ? s.causeLabel : '',
        stopClassLabel(s.classification)
      ]);
    }
    downloadCsv(`arrets_${this.machine.id}.csv`, rows);
  };

  /** Pareto of stop causes (planned/unplanned): bars of downtime or frequency, highest first. */
  private renderPareto(): TemplateResult {
    const sorted = this.paretoRows();
    const rows = this.paretoTop > 0 ? sorted.slice(0, this.paretoTop) : sorted;
    const head = html`
      <div class="block-head">
        <div class="block-title">${localizeDir(MSG.machineDash.paretoTitle)}</div>
        <span class="grow"></span>
        <ix-select
          class="class-select"
          .value=${this.paretoClass}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoClass(e.detail)}
        >
          ${PARETO_CLASS_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${localize(o.label)}></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          class="metric-select"
          .value=${this.paretoMetric}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoMetric(e.detail)}
        >
          ${PARETO_METRIC_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${localize(o.label)}></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          class="top-select"
          .value=${String(this.paretoTop)}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onParetoTop(e.detail)}
        >
          ${PARETO_TOP_OPTIONS.map(
            (o) => html`<ix-select-item value=${o.value} label=${localize(o.label)}></ix-select-item>`
          )}
        </ix-select>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title=${localize(MSG.machineDash.exportParetoCsv)}
          ?disabled=${sorted.length === 0}
          @click=${this.exportParetoCsv}
        ></ix-icon-button>
        <ix-button
          variant="secondary"
          title=${localize(MSG.machineDash.openAnalysisTitle)}
          @click=${this.openAnalysis}
        >
          <ix-icon name="analysis" slot="icon"></ix-icon>${localizeDir(MSG.machineDash.analyse)}
        </ix-button>
      </div>
    `;
    if (this.loading) return html`${head}<div class="center"><ix-spinner></ix-spinner></div>`;
    if (rows.length === 0) {
      const label = this.paretoClass === 'planned'
        ? localize(MSG.machineDash.classPlanned)
        : localize(MSG.machineDash.classUnplanned);
      return html`${head}<div class="muted small">${noStopOfClassMsg(label)}</div>`;
    }
    return html`${head}${this.renderParetoChart(rows)}`;
  }

  /** Pareto chart (SVG): descending bars and axes, without a cumulative-% curve. */
  private renderParetoChart(rows: CauseRow[]): TemplateResult {
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
    const metric = this.paretoMetric;
    const fmt = (v: number): string => formatMetric(metric, v);
    const axisColor = 'var(--theme-color-soft-bdr)';
    const textColor = 'var(--theme-color-soft-text)';
    return html`
      <svg class="pareto-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line x1=${x0} y1=${y0} x2=${x0} y2=${y1} stroke=${axisColor}></line>
        <line x1=${x0} y1=${y1} x2=${x1} y2=${y1} stroke=${axisColor}></line>
        <text x=${x0 - 6} y=${y0 + 8} text-anchor="end" fill=${textColor} font-size="11">${fmt(maxVal)}</text>
        ${rows.map((r, i) => {
          const h = (this.metricVal(r) / maxVal) * plotH;
          const x = x0 + (i + 0.5) * step - barW / 2;
          return svg`<rect x=${x} y=${y1 - h} width=${barW} height=${Math.max(h, 1)}
            rx="2" fill=${BAR_COLORS[i % BAR_COLORS.length]}><title>${r.label} — ${fmt(this.metricVal(r))}</title></rect>
            <text x=${x0 + (i + 0.5) * step} y=${y1 - h - 4} text-anchor="middle" fill=${textColor} font-size="10">${fmt(this.metricVal(r))}</text>
            <text x=${x0 + (i + 0.5) * step} y=${y1 + 12} transform="rotate(35 ${x0 + (i + 0.5) * step} ${y1 + 12})" fill=${textColor} font-size="10">${truncate(r.label, 22)}</text>`;
        })}
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
      [
        localize(MSG.machineDash.csvCause),
        localize(MSG.machineDash.csvClassification),
        localize(MSG.machineDash.csvDowntimeSec),
        localize(MSG.machineDash.csvDowntime),
        localize(MSG.machineDash.csvOccurrences),
        localize(MSG.machineDash.csvCumulPct)
      ]
    ];
    let cum = 0;
    for (const r of sorted) {
      cum += this.metricVal(r);
      rows.push([
        r.label,
        r.classification ?? '',
        String(Math.round(r.assignedMs / 1000)),
        formatDuration(r.assignedMs),
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

  /**
   * Re-query the archived history and rebuild the Gantt + the Pareto.
   *
   * `silent` skips the spinner: a live refresh must not blank the timeline the
   * operator is reading. Several triggers coexist (period change, live
   * transition, background tick), so a query that has been superseded while it
   * was in flight is dropped rather than overwriting a fresher result.
   */
  private async reload(silent = false): Promise<void> {
    const m = this.machine;
    const gen = ++this.reloadGen;
    if (!this.api || !m.stateDp) {
      this.segmentsAll = [];
      this.paretoAll = [];
      this.stopsAll = [];
      this.contextDims = [];
      this.loading = false;
      return;
    }
    if (!silent) this.loading = true;
    const { start, end } = this.resolveRange();
    if (start >= end) {
      this.loading = false;
      return;
    }
    this.windowMs = { start: start.getTime(), end: end.getTime() };
    const all = this.store ? await this.store.listQualifications() : [];
    if (gen !== this.reloadGen) return;
    this.qualifications = all.filter((q) => q.machineId === m.id && q.atelierId === this.atelierId);
    const segments = await this.buildSegments(m, start, end);
    const contextDims = await this.buildContext(m, start, end);
    // Stops without a cause datapoint still count: they are listed without a cause.
    const analysis = await this.analyse(m, start, end);
    if (gen !== this.reloadGen) return;
    this.segmentsAll = segments;
    this.contextDims = contextDims;
    this.paretoAll = analysis.rows;
    this.stopsAll = analysis.stops;
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
    const causeSamples: HistorySample[] = applyQualifications(
      m.stopCauseDp ? await queryHistory(this.api, m.stopCauseDp, start, end) : [],
      this.qualifications
    );
    const startMs = start.getTime();
    const endMs = end.getTime();
    const segs: StateSegment[] = [];
    for (const [i, s] of samples.entries()) {
      const segStart = Math.max(s.t, startMs);
      const segEnd = Math.min(samples[i + 1] ? samples[i + 1].t : endMs, endMs);
      if (segEnd <= segStart) continue;
      const state = resolveState(this.mapping, Math.round(Number(s.v)));
      const running = isRunningState(this.mapping, state);
      const causeLabel = running ? undefined : this.causeAt(causeSamples, segStart);
      const code = running ? undefined : this.codeAt(causeSamples, segStart);
      const last = segs.at(-1);
      if (last && last.state === state && last.causeLabel === causeLabel && last.endMs >= segStart) {
        last.endMs = segEnd;
      } else {
        const given = code ? qualificationAt(this.qualifications, segStart) : undefined;
        const qual = given && given.code === code ? given : undefined;
        segs.push({ state, startMs: segStart, endMs: segEnd, causeLabel, code, ...(qual ? { qualifiedBy: qual.user } : {}) });
      }
    }
    return this.withoutShortStops(segs, samples, startMs, endMs, (m.minStopSec ?? 0) * 1000);
  }

  /**
   * The Gantt segments with the stops shorter than the machine's minimum (MachineDef.minStopSec)
   * drawn as production, then merged with their neighbours.
   */
  private withoutShortStops(
    segs: StateSegment[],
    samples: HistorySample[],
    startMs: number,
    endMs: number,
    minStopMs: number
  ): StateSegment[] {
    const short = shortStopIntervals(samples, this.mapping, startMs, endMs, minStopMs);
    if (short.length === 0) return segs;
    const running = statesOf(this.mapping).find((s) => isRunningState(this.mapping, s.key))?.key ?? 'ok';
    const out: StateSegment[] = [];
    for (const seg of segs) {
      const inShort = short.some((i) => seg.startMs >= i.s && seg.endMs <= i.e);
      const next = inShort ? { ...seg, state: running, causeLabel: undefined } : seg;
      const last = out.at(-1);
      if (last && last.state === next.state && last.causeLabel === next.causeLabel && last.endMs >= next.startMs) {
        last.endMs = next.endMs;
      } else {
        out.push({ ...next });
      }
    }
    return out;
  }

  /** Stop-cause code active at time `t` ('' when none). */
  private codeAt(samples: HistorySample[], t: number): string {
    let code = '';
    for (const s of samples) {
      if (s.t > t) break;
      code = s.v == null ? '' : String(s.v).trim();
    }
    return code;
  }

  /**
   * A stop may be given a cause (#272): with the role and a catalog, once it is over and seen whole —
   * not touching an edge of the period shown (an ongoing stop, or one the period cuts, would be
   * qualified in part only, and under another start each time).
   */
  private qualifiable(startMs: number, endMs: number): boolean {
    if (!this.canQualify || !this.store || this.stopCauses.length === 0) return false;
    const w = this.windowMs;
    return startMs > w.start + EDGE_MS && endMs < w.end - EDGE_MS;
  }

  private canQualifySegment(s: StateSegment): boolean {
    return !isRunningState(this.mapping, s.state) && this.qualifiable(s.startMs, s.endMs);
  }

  private qualifySegment(s: StateSegment): void {
    if (!this.canQualifySegment(s)) return;
    this.tip = null;
    this.openQualify({ startMs: s.startMs, endMs: s.endMs, code: s.code ?? '', label: s.causeLabel ?? '' });
  }

  private openQualify(target: QualifyTarget): void {
    if (!this.qualifiable(target.startMs, target.endMs)) return;
    this.qualifyError = false;
    this.qualifying = target;
  }

  private renderQualify(): TemplateResult {
    const q = this.qualifying;
    if (!q) return html``;
    return html`<mf-qualify-dialog
      .causes=${this.stopCauses}
      period=${`${formatDateTime(q.startMs)} → ${formatDateTime(q.endMs)} (${formatDuration(q.endMs - q.startMs)})`}
      current=${q.label}
      initialCode=${q.code}
      @wui:confirm=${(e: CustomEvent<{ code: string; reason: string }>) => void this.qualify(q, e.detail.code, e.detail.reason)}
      @wui:cancel=${() => (this.qualifying = null)}
    ></mf-qualify-dialog>`;
  }

  /** Give `code` to the stop (#272): stored apart from the history, traced, then reloaded. */
  private async qualify(target: QualifyTarget, code: string, reason: string): Promise<void> {
    if (!this.store) return;
    this.qualifying = null;
    const user = await currentAuditUser();
    // The machine's own code: the one kept by a cause given earlier, else the stop's code (no overlay).
    const previous = qualificationAt(this.qualifications, target.startMs);
    const ok = await this.store.saveQualification({
      atelierId: this.atelierId,
      machineId: this.machine.id,
      startMs: target.startMs,
      endMs: target.endMs,
      code,
      machineCode: previous ? previous.machineCode : target.code,
      reason,
      user: user.name || String(user.id),
      at: new Date().toISOString()
    });
    this.qualifyError = !ok;
    if (ok) await this.reload(true);
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

  private async analyse(m: Machine, start: Date, end: Date): Promise<{ rows: CauseRow[]; stops: RawStop[] }> {
    const target: AnalysisMachine = {
      atelierId: this.atelierId,
      atelierName: this.atelierName,
      machineId: m.id,
      machineName: m.name,
      stateDp: m.stateDp ?? '',
      stopCauseDp: m.stopCauseDp ?? '',
      mapping: this.mapping,
      minStopMs: (m.minStopSec ?? 0) * 1000
    };
    const result = await analyseStopCauses(this.api, [target], this.stopCauses, start, end, new Map(), this.qualifications);
    // Keep both planned & unplanned; the Pareto filters by the chosen class. A stop with no
    // cause and no catalog default has no classification: it is unplanned (as in the TRS).
    const rows = result.rows
      .map((r) => (r.classification ? r : { ...r, classification: 'unplanned' as const }))
      .filter((r) => r.classification === 'unplanned' || r.classification === 'planned');
    return { rows, stops: result.rawStops };
  }

  /** Pareto rows for the current class, sorted by the current metric. */
  private paretoRows(): CauseRow[] {
    const inClass = this.pareto.filter((r) => r.classification === this.paretoClass);
    return sortRows(inClass, this.paretoMetric === 'downtime' ? 'assigned' : 'occurrences');
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };
}

/** Label of a stop's class; no class (no cause, no catalog default) is unplanned. */
function stopClassLabel(c: RawStop['classification']): string {
  if (c === 'planned') return localize(MSG.machineDash.classPlanned);
  if (c === 'production') return localize(MSG.machineDash.classProduction);
  return localize(MSG.machineDash.classUnplanned);
}

/** A card's value: the parameter's own decimals when it sets them, else {@link formatValue}. */
function formatCardValue(v: number, decimals?: number): string {
  return decimals != null ? formatParamValue(v, decimals) : formatValue(v);
}

/** Format a gauge/card value: two decimals, dropped for large magnitudes. */
function formatValue(v: number): string {
  if (Number.isInteger(v) || Math.abs(v) >= COMPACT_VALUE_THRESHOLD) return String(Math.round(v));
  return v.toFixed(VALUE_DECIMALS);
}

/**
 * Readable gauge bounds around an observed [min,max] band.
 *
 * A band still collapsed on a single value gets head-room instead of a full or
 * empty arc; a real band is padded and both ends rounded outwards to a "nice"
 * number so the printed bounds stay legible.
 */
function niceScale(min: number, max: number): { min: number; max: number } {
  if (min === max) {
    if (min > 0) return { min: 0, max: niceBound(min * GAUGE_SOLO_HEADROOM) };
    if (min < 0) return { min: -niceBound(-min * GAUGE_SOLO_HEADROOM), max: 0 };
    return { min: 0, max: 1 };
  }
  const pad = (max - min) * GAUGE_BAND_PADDING;
  const lo = min - pad;
  const hi = max + pad;
  return {
    min: lo >= 0 ? 0 : -niceBound(-lo),
    max: hi <= 0 ? 0 : niceBound(hi)
  };
}

/** Smallest "nice" number (1/1.5/2/2.5/3/4/5/7.5/10 × 10^k) greater or equal to `v`. */
function niceBound(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const normalised = v / magnitude;
  const step = NICE_STEPS.find((s) => normalised <= s) ?? 10;
  return step * magnitude;
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

/** Format a ms-epoch timestamp as a French date+time (minute precision). */
function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Same, to the SECOND — for the exports.
 *
 * A state change is timestamped to the millisecond in the archive, so a Gantt
 * exported at minute precision cannot be used to compute segment durations:
 * `dd/mm/yyyy hh:mm:ss` is what Excel needs to subtract two boundaries (and it
 * parses that shape natively in a French locale).
 */
function formatDateTimeSec(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
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
    }
    /* Full screen: the four bands each need their room, so the dashboard takes
       all of it rather than shrinking a panel out of readability. The overlay is
       inset:0, so stretching inside it is exact — 100vw would over-shoot by a
       scrollbar's width. */
    .panel {
      background: var(--theme-color-2);
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      flex: 0 0 auto;
    }
    .panel-head .dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
    }
    .grow {
      flex: 1;
    }
    /* The content column scrolls as a whole: a viewport too short pushes the
       bottom band down, it never squeezes it away. */
    .content {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
    }
    .bottom-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      flex: 1 1 auto;
      min-height: 22rem;
    }
    /* Two half-width panels only while both stay readable; below that they stack. */
    @media (max-width: 1100px) {
      .bottom-row {
        grid-template-columns: 1fr;
      }
    }
    .toolbar {
      margin: 0.75rem 0.75rem 0;
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
    .zone {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .zone-params {
      flex: 0 0 auto;
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    .zone-gantt {
      flex: 0 0 auto;
      background: color-mix(in srgb, #10b981 8%, transparent);
    }
    .zone-alarms {
      background: var(--theme-color-1);
      overflow: hidden;
    }
    .zone-alarms wui-alarm-view {
      flex: 1;
      min-height: 0;
    }
    .zone-pareto {
      background: color-mix(in srgb, #10b981 8%, transparent);
      /* The chart keeps its floor size and the panel scrolls rather than crop it. */
      overflow: auto;
    }
    .dash-filters {
      margin: 0.5rem 0.75rem 0;
    }
    .zone-stops {
      flex: 0 0 auto;
      background: var(--theme-color-1);
    }
    .stops-scroll {
      max-height: 18rem;
      overflow: auto;
    }
    table.stops {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    table.stops th,
    table.stops td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      text-align: left;
      white-space: nowrap;
    }
    table.stops th {
      position: sticky;
      top: 0;
      background: var(--theme-color-1);
      color: var(--theme-color-soft-text);
      font-weight: 600;
    }
    table.stops .num {
      text-align: right;
    }
    .zone h4 {
      margin: 0 0 0.5rem;
      font-size: 0.95rem;
    }
    /* Context line above the cards: label over value, wrapping, outside the cap. */
    .context {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1.5rem;
      margin: 0 0 0.6rem;
      padding: 0 0 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .ctx-item {
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-width: 18rem;
    }
    .ctx-label {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .ctx-value {
      font-size: 0.95rem;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /*
     * Parameter band: cards wrap onto as many rows as needed, and the band
     * scrolls past two rows (three on a tall screen) so a machine with a dozen
     * bound parameters never pushes the Gantt and the bottom panels off-screen.
     * Rows are a fixed height and the cap is a whole multiple of it — the cut
     * always falls between two rows, never through a card.
     */
    .cards {
      --card-h: 9.5rem;
      --card-gap: 0.6rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
      grid-auto-rows: var(--card-h);
      gap: var(--card-gap);
      overflow: auto;
      max-height: calc(2 * var(--card-h) + var(--card-gap));
    }
    @media (min-height: 1000px) {
      .cards {
        max-height: calc(3 * var(--card-h) + 2 * var(--card-gap));
      }
    }
    /* A short screen gives the band one row: the four bands stay on screen
       together and the extra parameters are one scroll away inside it. */
    @media (max-height: 820px) {
      .cards {
        max-height: var(--card-h);
      }
    }
    .card {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      /* The card is a read-out, not a control. */
      cursor: default;
    }
    /* ix-card-content is a flex ROW padded 1rem — stack our three lines instead,
       and tighten the padding so the gauge keeps its room inside the fixed row. */
    .card ix-card-content {
      flex-direction: column;
      justify-content: center;
      padding: 0.55rem 0.6rem;
      width: 100%;
    }
    .card-label {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
      line-height: 1.2;
      min-height: 2.4em;
      flex: 0 0 auto;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    /* A non-numeric parameter (programme, outil…): the value replaces the gauge,
       clamped to the card's row — the full string stays in the tooltip. */
    .card-text {
      font-size: 1.1rem;
      font-weight: 700;
      padding: 1rem 0;
      text-align: center;
      overflow-wrap: anywhere;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .card-hint {
      font-size: 0.68rem;
      color: var(--theme-color-soft-text);
      text-align: center;
      flex: 0 0 auto;
    }
    /* Capped so a card stretched wider than its track keeps the gauge inside the
       fixed row height (ix-card clips its overflow). */
    .gauge-svg {
      width: 100%;
      max-height: 5.5rem;
      display: block;
      flex: 0 1 auto;
      min-height: 0;
    }
    .gauge-track {
      fill: none;
      stroke: var(--theme-color-soft-bdr);
      stroke-width: 8;
      stroke-linecap: round;
    }
    .gauge-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dasharray 0.4s ease;
    }
    .gauge-value {
      fill: var(--theme-color-std-text);
      font-size: 15px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .gauge-unit {
      fill: var(--theme-color-soft-text);
      font-size: 9px;
    }
    .gauge-bound {
      fill: var(--theme-color-soft-text);
      font-size: 7px;
      font-variant-numeric: tabular-nums;
    }
    .block-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
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
    /* A block that opens its zone needs no extra top margin. */
    .zone > .block-head:first-child {
      margin-top: 0;
    }
    .top-select {
      min-width: 7rem;
    }
    /* Narrow enough for the half-width Pareto panel; the head wraps beyond that. */
    .metric-select {
      min-width: 9.5rem;
    }
    .class-select {
      min-width: 9.5rem;
    }
    .range {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    .gantt {
      width: 100%;
      height: 64px;
      border-radius: 0.2rem;
      background: var(--theme-color-1);
    }
    .gantt rect {
      cursor: pointer;
    }
    .qualify-error {
      color: var(--theme-color-alarm);
      margin-bottom: 0.3rem;
    }
    .gantt-mark {
      stroke: var(--theme-color-std-text);
      stroke-width: 1;
      stroke-opacity: 0.55;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
    .gantt-axis {
      position: relative;
      height: 1.1rem;
      margin-top: 0.15rem;
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
    }
    .gantt-axis .tick {
      position: absolute;
      top: 0;
      white-space: nowrap;
      transform: translateX(-50%);
    }
    .gantt-axis .tick--start {
      transform: none;
    }
    .gantt-axis .tick--end {
      transform: translateX(-100%);
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
      min-height: 220px;
      margin-top: 0.25rem;
    }
    .center {
      flex: 1;
      min-height: 5rem;
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
      .content {
        overflow: visible;
      }
      /* On paper the two bottom panels get a full width each rather than half. */
      .bottom-row {
        display: block;
        min-height: 0;
      }
      .bottom-row .zone + .zone {
        margin-top: 0.75rem;
      }
      .zone {
        overflow: visible;
        break-inside: avoid;
      }
      .gantt rect,
      .pareto-svg rect,
      .pareto-svg polyline,
      .pareto-svg circle,
      .gauge-svg path,
      .leg i,
      .panel-head .dot {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
}
