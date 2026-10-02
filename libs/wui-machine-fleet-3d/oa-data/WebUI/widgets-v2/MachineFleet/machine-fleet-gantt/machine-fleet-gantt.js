// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `mf-widget-gantt` — **Machine Fleet Gantt** dashboard widget.
 *
 * The state Gantt of the fleet's built-in machine dashboard, as a WinCC OA
 * dashboard widget: a proportional, coloured timeline of ONE machine's state
 * history over the dashboard time range, each stop segment carrying the stop
 * cause active at that moment (hover bubble), with a legend conforming to the
 * machine's state mapping, a time axis and a CSV export to the second.
 *
 * Inputs (all set by the dashboard's context layer — the widget never queries):
 *   state          `{ value: { values, timestamps }, name }` — archived history
 *                  of the machine's state DP (`MachineSim_<m>.state`).
 *   cause          same shape for the stop-cause DP (`MachineSim_<m>.cause`).
 *   stateMapping   JSON — the atelier config (`MachineFleet3D_<a>.json`), a
 *                  mapping array, or one mapping. Missing → the fleet default.
 *   machineId / stateMappingId   which mapping to pick inside an atelier config.
 *   stopCauses     JSON — the catalog (`MachineFleet3D_StopCauses.json`).
 *   sTimeRange     the dashboard time range (spread from the widget `variables`).
 *   showLegend / showRangePicker / showTooltip / showTimeAxis   booleans.
 *
 * The range button dispatches the dashboard's `wui:changedaterange` event; the
 * `data-point` contexts above the widget listen to it and re-query both
 * histories — no fetch happens here.
 */
import { LitElement, css, html, nothing, svg } from 'lit';
import '@wincc-oa/wui-ui-elements/wui-datetime-range-button/wui-datetime-range-button.js';
import {
  ALL_STATES,
  STATE_LABELS,
  buildSegments,
  downloadCsv,
  fileSlug,
  formatDateTimeSec,
  formatDuration,
  formatTick,
  mappingStates,
  ml,
  niceTicks,
  parseCatalog,
  parseMapping,
  resolveWindow,
  stateColor,
  t,
  toSamples
} from '../machine-fleet-core.js';

const MSG = {
  noHistory: ml(
    'No archived state in this period.',
    'Aucun état archivé sur cette période.',
    'Kein archivierter Zustand in diesem Zeitraum.'
  ),
  noBinding: ml(
    'Bind the machine state datapoint in the widget settings.',
    'Liez le datapoint d’état machine dans les paramètres du widget.',
    'Binden Sie den Maschinenzustand-Datenpunkt in den Widget-Einstellungen.'
  ),
  unknown: ml(
    'Unknown (before first sample)',
    'Inconnu (avant le premier échantillon)',
    'Unbekannt (vor der ersten Probe)'
  ),
  exportCsv: ml(
    'Export the Gantt (CSV)',
    'Exporter le Gantt (CSV)',
    'Gantt exportieren (CSV)'
  ),
  start: ml('Start', 'Début', 'Beginn'),
  end: ml('End', 'Fin', 'Ende'),
  duration: ml('Duration', 'Durée', 'Dauer'),
  cause: ml('Cause', 'Cause', 'Ursache'),
  state: ml('State', 'État', 'Zustand'),
  running: ml('ongoing', 'en cours', 'laufend')
};

/** SVG user units of the timeline (wide so a 0.1 % segment still rounds to ≥1 unit). */
const BAR_W = 1000;
const BAR_H = 10;
const MIN_SEG_W = 1;
/** Re-render cadence while the window ends at "now" (stretches the running segment). */
const LIVE_TICK_MS = 30_000;
const TIP_OFFSET_PX = 12;
/** Distance (in % of the bar) inside which an axis tick counts as an edge tick. */
const EDGE_PCT = 4;

export class MfWidgetGantt extends LitElement {
  static properties = {
    state: { attribute: false },
    cause: { attribute: false },
    stateMapping: { type: String },
    stateMappingId: { type: String },
    machineId: { type: String },
    stopCauses: { type: String },
    sTimeRange: { type: String },
    showLegend: { type: Boolean },
    showRangePicker: { type: Boolean },
    showTooltip: { type: Boolean },
    showTimeAxis: { type: Boolean },
    tip: { state: true }
  };

  static styles = css`
    :host {
      display: block;
      position: relative;
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
      gap: 0.25rem;
      height: 100%;
      box-sizing: border-box;
      padding: 0.25rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
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
    .bar {
      flex: 1 1 auto;
      min-height: 1rem;
      width: 100%;
      display: block;
      border-radius: 3px;
      background: var(--theme-color-2);
    }
    .bar rect {
      cursor: default;
    }
    .axis {
      position: relative;
      height: 1.1rem;
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
    }
    .axis span {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .axis span.first {
      transform: none;
    }
    .axis span.last {
      transform: translateX(-100%);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.15rem 0.75rem;
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .legend i {
      display: inline-block;
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 2px;
      margin-right: 0.3rem;
      vertical-align: -1px;
    }
    .legend i.unknown {
      background: repeating-linear-gradient(
        135deg,
        var(--theme-color-soft-bdr) 0 2px,
        transparent 2px 4px
      );
    }
    .muted {
      color: var(--theme-color-soft-text);
      padding: 0.25rem 0;
    }
    .tip {
      position: absolute;
      z-index: 5;
      pointer-events: none;
      max-width: 22rem;
      padding: 0.35rem 0.5rem;
      border-radius: 4px;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
      font-size: 0.72rem;
      line-height: 1.35;
    }
    .tip .st {
      font-weight: 600;
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
    this.showLegend = false;
    this.showRangePicker = false;
    this.showTooltip = false;
    this.showTimeAxis = false;
    this.tip = undefined;
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

  render() {
    const model = this.model();
    this.lastLive = model.live;
    return html`
      <div class="root">
        ${this.renderHead(model)}
        ${model.bound ? this.renderTimeline(model) : html`<div class="muted">${t(MSG.noBinding)}</div>`}
        ${this.showLegend && model.bound ? this.renderLegend(model) : nothing}
      </div>
      ${this.renderTip(model)}
    `;
  }

  /** Everything derived from the inputs, computed once per render. */
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
    const segments = buildSegments(
      stateSamples,
      causeSamples,
      mapping,
      catalog,
      start,
      end
    );
    return {
      bound: this.state != undefined,
      name: typeof this.state?.name === 'string' ? this.state.name : '',
      mapping,
      segments,
      start,
      end,
      live,
      firstKnown: segments.length > 0 ? segments[0].startMs : end
    };
  }

  renderHead(model) {
    return html`
      <div class="head">
        ${model.name ? html`<span class="name" title=${model.name}>${model.name}</span>` : nothing}
        <span class="grow"></span>
        <ix-icon-button
          ghost
          size="16"
          icon="export"
          title=${t(MSG.exportCsv)}
          ?disabled=${model.segments.length === 0}
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

  renderTimeline(model) {
    const { segments, start, end, mapping } = model;
    if (segments.length === 0)
      return html`<div class="muted">${t(MSG.noHistory)}</div>`;
    const span = end - start || 1;
    const x = (ms) => ((ms - start) / span) * BAR_W;
    const unknownW = x(model.firstKnown);
    return html`
      <svg
        class="bar"
        viewBox="0 0 ${BAR_W} ${BAR_H}"
        preserveAspectRatio="none"
        @pointerleave=${this.hideTip}
      >
        <defs>
          <pattern
            id="unk"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect
              width="3"
              height="6"
              fill="var(--theme-color-soft-bdr)"
              opacity="0.6"
            ></rect>
          </pattern>
        </defs>
        ${this.renderUnknown(unknownW)}
        ${segments.map((s) => {
          const sx = x(s.startMs);
          const w = Math.max(x(s.endMs) - sx, MIN_SEG_W);
          return svg`<rect x=${sx} y="0" width=${w} height=${BAR_H} fill=${stateColor(mapping, s.state)}
            @pointermove=${(event) => this.showTip(event, s)}></rect>`;
        })}
      </svg>
      ${this.showTimeAxis ? this.renderAxis(start, end) : nothing}
    `;
  }

  /** The hatched "state unknown" span before the first archived sample. */
  renderUnknown(width) {
    if (width <= 0) return nothing;
    return svg`<rect x="0" y="0" width=${width} height=${BAR_H} fill="url(#unk)"
      @pointermove=${(event) => this.showTip(event)}></rect>`;
  }

  renderAxis(start, end) {
    const span = end - start || 1;
    const ticks = niceTicks(start, end);
    return html`
      <div class="axis">
        ${ticks.map((ms) => {
          const pct = ((ms - start) / span) * 100;
          const cls = tickClass(pct);
          return html`
            <span class=${cls} style="left:${pct.toFixed(2)}%"
              >${formatTick(ms, span)}</span
            >
          `;
        })}
      </div>
    `;
  }

  renderLegend(model) {
    const states = model.mapping ? mappingStates(model.mapping) : ALL_STATES;
    return html`
      <div class="legend">
        ${states.map((st) => html`<span><i style="background:${stateColor(model.mapping, st)}"></i>${t(STATE_LABELS[st])}</span>`)}
        ${model.firstKnown > model.start ? html`<span><i class="unknown"></i>${t(MSG.unknown)}</span>` : nothing}
      </div>
    `;
  }

  renderTip(model) {
    const tip = this.tip;
    if (!tip || !this.showTooltip) return nothing;
    const s = tip.seg;
    if (!s) {
      return html`
        <div class="tip" style="left:${tip.x}px;top:${tip.y}px">
          <div class="st">${t(MSG.unknown)}</div>
          <div>${t(MSG.start)}: ${formatDateTimeSec(model.start)}</div>
          <div>${t(MSG.end)}: ${formatDateTimeSec(model.firstKnown)}</div>
        </div>
      `;
    }
    const running = model.live && s.endMs >= model.end;
    return html`
      <div class="tip" style="left:${tip.x}px;top:${tip.y}px">
        <div class="st" style="color:${stateColor(model.mapping, s.state)}">
          ${t(STATE_LABELS[s.state])}
        </div>
        <div>${t(MSG.start)}: ${formatDateTimeSec(s.startMs)}</div>
        <div>
          ${t(MSG.end)}:
          ${running ? t(MSG.running) : formatDateTimeSec(s.endMs)}
        </div>
        <div>${t(MSG.duration)}: ${formatDuration(s.endMs - s.startMs)}</div>
        ${s.causeLabel ? html`<div>${t(MSG.cause)}: ${s.causeLabel}</div>` : nothing}
      </div>
    `;
  }

  showTip(event, seg) {
    if (!this.showTooltip) return;
    const host = this.getBoundingClientRect();
    let x = event.clientX - host.left + TIP_OFFSET_PX;
    const y = event.clientY - host.top + TIP_OFFSET_PX;
    // Keep the bubble inside the widget: flip to the left near the right edge.
    if (x > host.width * 0.6)
      x = Math.max(0, event.clientX - host.left - host.width * 0.4);
    this.tip = { x, y, seg };
  }

  hideTip = () => {
    this.tip = undefined;
  };

  /**
   * The user picked a new range: tell the contexts above (they own the query)
   * and adopt it locally so the window and the button label follow at once.
   */
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
    const rows = [[t(MSG.start), t(MSG.end), t(MSG.state), t(MSG.cause)]];
    for (const s of model.segments) {
      rows.push([
        formatDateTimeSec(s.startMs),
        formatDateTimeSec(s.endMs),
        t(STATE_LABELS[s.state]),
        s.causeLabel
      ]);
    }
    downloadCsv(`gantt_${fileSlug(model.name || this.machineId)}.csv`, rows);
  }
}

/** Edge ticks are anchored inward so their labels never overflow the bar. */
function tickClass(pct) {
  if (pct < EDGE_PCT) return 'first';
  if (pct > 100 - EDGE_PCT) return 'last';
  return '';
}

if (!customElements.get('mf-widget-gantt'))
  customElements.define('mf-widget-gantt', MfWidgetGantt);
