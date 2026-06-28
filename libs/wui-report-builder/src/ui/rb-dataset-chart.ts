// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Line chart for a dataset section: fetches each datapoint's archived history
 * over the report period and plots it. Self-contained (resolves OaRxJsApi);
 * exposes `getImageDataUrl()` for printing. `echarts` resolves via the
 * shared-bundle import map, like the thermal-reports curve.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import { readSeries, type Sample } from '../engine.js';
import type { DatasetDef } from '../types.js';

const CHART_HEIGHT_PX = 280;
const COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#14b8a6'];

@customElement('rb-dataset-chart')
export class RbDatasetChart extends LitElement {
  static override readonly styles = [IXCoreStyles, chartStyles()];

  @property({ attribute: false }) datasets: DatasetDef[] = [];
  @property() start = '';
  @property() end = '';

  @state() private empty = false;

  private readonly api = this.resolveApi();
  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private seriesData: { label: string; samples: Sample[] }[] = [];
  private lastKey = '';

  override render(): TemplateResult {
    return html`
      <div class="chart" id="chart"></div>
      ${this.empty ? html`<div class="empty">Aucune donnée archivée sur la période.</div>` : ''}
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  /** PNG data URL of the chart (for printing); empty when nothing rendered. */
  getImageDataUrl(): string {
    if (!this.chart || this.empty) return '';
    this.chart.resize();
    return this.chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
  }

  protected override updated(_changed: PropertyValues): void {
    const key = `${this.start}|${this.end}|${this.datasets.map((d) => d.dp).join(',')}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      void this.reload();
    }
  }

  private async reload(): Promise<void> {
    const start = new Date(this.start);
    const end = new Date(this.end);
    const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
    const out: { label: string; samples: Sample[] }[] = [];
    if (valid) {
      for (const d of this.datasets) {
        if (!d.dp) continue;
        // eslint-disable-next-line no-await-in-loop -- a handful of datasets
        const samples = await readSeries(this.api, d.dp, start, end);
        out.push({ label: d.label || d.dp, samples });
      }
    }
    this.seriesData = out;
    this.empty = out.every((s) => s.samples.length === 0);
    this.draw();
  }

  private draw(): void {
    const host = this.renderRoot.querySelector<HTMLElement>('#chart');
    if (!host) return;
    if (!this.chart) {
      this.chart = echarts.init(host);
      this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
      this.resizeObserver.observe(host);
    }
    const text = this.cssVar('--theme-color-std-text', '#e8e8e8');
    const grid = this.cssVar('--theme-color-soft-bdr', '#444');
    this.chart.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        textStyle: { color: text },
        tooltip: { trigger: 'axis' },
        legend: { textStyle: { color: text }, top: 0 },
        grid: { left: 8, right: 16, top: 32, bottom: 24, containLabel: true },
        xAxis: { type: 'time', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid, opacity: 0.4 } } },
        yAxis: { type: 'value', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid, opacity: 0.4 } } },
        series: this.seriesData.map((s, i) => ({
          name: s.label,
          type: 'line',
          showSymbol: false,
          smooth: true,
          lineStyle: { color: COLORS[i % COLORS.length], width: 2 },
          itemStyle: { color: COLORS[i % COLORS.length] },
          data: s.samples.map((p) => [p.t, p.v])
        }))
      },
      true
    );
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

function chartStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      width: 100%;
      position: relative;
    }
    .chart {
      width: 100%;
      height: ${CHART_HEIGHT_PX}px;
    }
    .empty {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
      pointer-events: none;
    }
  `;
}
