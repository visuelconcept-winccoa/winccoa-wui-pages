// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Historical trends: one archived signal over a selectable period, drawn with
 * echarts (resolved via the shared-bundle import map, like the other pages).
 * The signal and period selectors drive a `dpGetPeriod` query on the station DP.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { sensorByPath, type SensorField } from '../model.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { loadTrend } from '../data/api.js';
import type { TrendSample } from '../types.js';

const LINE_COLOR = '#00b3b3';
const HOUR_MS = 3_600_000;

/** Signals offered in the selector (the process values worth trending). */
const TREND_PATHS = ['inlet.flow', 'outlet.flow', 'bio.do', 'outlet.tss', 'outlet.cod', 'outlet.nh4', 'energy.power'];

interface PeriodOpt {
  id: string;
  hours: number;
  label: typeof MSG.trends.last1h;
}
const PERIODS: PeriodOpt[] = [
  { id: '1h', hours: 1, label: MSG.trends.last1h },
  { id: '8h', hours: 8, label: MSG.trends.last8h },
  { id: '24h', hours: 24, label: MSG.trends.last24h },
  { id: '7d', hours: 24 * 7, label: MSG.trends.last7d }
];

export class PoseidonTrends extends LitElement {
  static override readonly styles = [IXCoreStyles, trendStyles()];

  @state() private path = TREND_PATHS[0];
  @state() private periodId = '8h';
  @state() private samples: TrendSample[] = [];
  @state() private loading = false;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  private get field(): SensorField | undefined {
    return sensorByPath(this.path);
  }

  private async reload(): Promise<void> {
    const hours = PERIODS.find((p) => p.id === this.periodId)?.hours ?? 8;
    const to = new Date();
    const from = new Date(to.getTime() - hours * HOUR_MS);
    this.loading = true;
    this.samples = await loadTrend(this.path, from, to);
    this.loading = false;
  }

  private onSignal(value: string | string[]): void {
    this.path = Array.isArray(value) ? (value[0] ?? this.path) : value;
    void this.reload();
  }

  private onPeriod(value: string | string[]): void {
    this.periodId = Array.isArray(value) ? (value[0] ?? this.periodId) : value;
    void this.reload();
  }

  override render(): TemplateResult {
    return html`
      <section class="trends">
        <div class="toolbar">
          <label class="ctl">
            <span>${localizeDir(MSG.trends.signal)}</span>
            <ix-select .value=${this.path} @valueChange=${(e: CustomEvent<string | string[]>) => this.onSignal(e.detail)}>
              ${TREND_PATHS.map((p) => {
                const f = sensorByPath(p);
                return html`<ix-select-item value=${p} label=${f ? localize(f.label) : p}></ix-select-item>`;
              })}
            </ix-select>
          </label>
          <label class="ctl">
            <span>${localizeDir(MSG.trends.period)}</span>
            <ix-select .value=${this.periodId} @valueChange=${(e: CustomEvent<string | string[]>) => this.onPeriod(e.detail)}>
              ${PERIODS.map((p) => html`<ix-select-item value=${p.id} label=${localize(p.label)}></ix-select-item>`)}
            </ix-select>
          </label>
        </div>
        ${this.loading
          ? html`<div class="note">${localizeDir(MSG.trends.loading)}</div>`
          : this.samples.length === 0
            ? html`<div class="note">${localizeDir(MSG.trends.noData)}</div>`
            : html`<div class="chart" id="chart"></div>`}
      </section>
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    if (!this.loading && this.samples.length > 0) this.renderChart();
  }

  private renderChart(): void {
    const host = this.renderRoot.querySelector<HTMLElement>('#chart');
    if (!host) return;
    if (!this.chart) {
      this.chart = echarts.init(host);
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(host);
    }
    this.chart.setOption(this.chartOption(), true);
  }

  // eslint-disable-next-line max-lines-per-function -- single echarts option literal
  private chartOption(): echarts.EChartsCoreOption {
    const text = this.cssVar('--theme-color-std-text', '#e8e8e8');
    const grid = this.cssVar('--theme-color-soft-bdr', '#444');
    const f = this.field;
    const name = f ? localize(f.label) : this.path;
    const unit = f?.unit ?? '';
    return {
      grid: { left: 60, right: 20, top: 30, bottom: 40 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: number) => `${Number(v).toFixed(f?.decimals ?? 1)}${unit ? ' ' + unit : ''}`
      },
      xAxis: {
        type: 'time',
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: grid } }
      },
      yAxis: {
        type: 'value',
        name: unit,
        scale: true,
        nameTextStyle: { color: text },
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: grid } }
      },
      series: [
        {
          name,
          type: 'line',
          showSymbol: false,
          smooth: true,
          lineStyle: { color: LINE_COLOR, width: 2 },
          areaStyle: { color: LINE_COLOR, opacity: 0.12 },
          data: this.samples.map((s) => [s.t, s.v])
        }
      ]
    };
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }
}

function trendStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .trends {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: flex-end;
    }
    .ctl {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.8rem;
      min-width: 12rem;
    }
    .chart {
      width: 100%;
      height: 360px;
    }
    .note {
      padding: 2rem;
      opacity: 0.7;
      text-align: center;
    }
  `;
}

if (!customElements.get('poseidon-trends')) {
  customElements.define('poseidon-trends', PoseidonTrends);
}
