// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Temperature curve for one thermal cycle: the *actual* temperature (read from
 * the furnace's archived history) over the setpoint staircase and its tolerance
 * band. `echarts` resolves via the shared-bundle import map (externalised by
 * `build:pages`), like the other standalone pages.
 *
 * The tolerance band is drawn with the standard echarts confidence-band trick:
 * an invisible "lower" series stacked under a filled "band" series of thickness
 * (hi − lo).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ProfilePoint, Sample } from '../engine.js';

const CHART_HEIGHT_PX = 340;
const ACTUAL_COLOR = '#0ea5e9';
const SETPOINT_COLOR = '#f59e0b';
const BAND_COLOR = '#10b981';

@customElement('tt-temp-chart')
export class TtTempChart extends LitElement {
  static override readonly styles = [IXCoreStyles, chartStyles()];

  @property({ attribute: false }) actual: Sample[] = [];
  @property({ attribute: false }) profile: ProfilePoint[] = [];

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  override render(): TemplateResult {
    return html`<div class="chart" id="chart"></div>`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  /** PNG data URL of the current chart (for printing); empty when not rendered. */
  getImageDataUrl(): string {
    if (!this.chart) return '';
    // Sync the canvas to its current on-screen size before capturing, so the
    // snapshot is never stale (the reason a page-zoom "sometimes helped").
    this.chart.resize();
    return this.chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
  }

  protected override updated(_changed: PropertyValues): void {
    this.renderChart();
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
    const lower = this.profile.map((p) => [p.t, p.lo]);
    const band = this.profile.map((p) => [p.t, Math.max(0, p.hi - p.lo)]);
    const setpoint = this.profile.map((p) => [p.t, p.setpoint]);
    const actual = this.actual.map((s) => [s.t, s.v]);
    return {
      backgroundColor: 'transparent',
      // No animation: a print capture (getDataURL) is then always the complete
      // curve, never a half-drawn frame.
      animation: false,
      textStyle: { color: text },
      tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => `${Number(v).toFixed(1)} °C` },
      legend: {
        data: ['Température réelle', 'Consigne', 'Tolérance'],
        textStyle: { color: text },
        top: 0
      },
      grid: { left: 8, right: 16, top: 36, bottom: 24, containLabel: true },
      xAxis: {
        type: 'time',
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: grid, opacity: 0.4 } }
      },
      yAxis: {
        type: 'value',
        name: '°C',
        nameTextStyle: { color: text },
        axisLabel: { color: text, formatter: '{value}' },
        splitLine: { lineStyle: { color: grid, opacity: 0.4 } }
      },
      series: [
        {
          name: 'bandBase',
          type: 'line',
          data: lower,
          stack: 'tol',
          step: 'end',
          symbol: 'none',
          lineStyle: { width: 0 },
          areaStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
          legendHoverLink: false
        },
        {
          name: 'Tolérance',
          type: 'line',
          data: band,
          stack: 'tol',
          step: 'end',
          symbol: 'none',
          lineStyle: { width: 0 },
          areaStyle: { color: BAND_COLOR, opacity: 0.16 },
          silent: true
        },
        {
          name: 'Consigne',
          type: 'line',
          data: setpoint,
          step: 'end',
          symbol: 'none',
          lineStyle: { color: SETPOINT_COLOR, width: 2, type: 'dashed' }
        },
        {
          name: 'Température réelle',
          type: 'line',
          data: actual,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: ACTUAL_COLOR, width: 2 },
          itemStyle: { color: ACTUAL_COLOR }
        }
      ]
    };
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }
}

function chartStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      width: 100%;
    }
    .chart {
      width: 100%;
      height: ${CHART_HEIGHT_PX}px;
    }
  `;
}
