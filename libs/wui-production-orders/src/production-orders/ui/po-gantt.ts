// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Planning / Gantt view of the production orders (echarts custom series).
 *
 * One row per order (label = N° OF · produit), a time x-axis, and a horizontal
 * bar spanning the planned start→end coloured by status. Orders without a valid
 * planned window are skipped. `echarts` resolves via the shared-bundle import
 * map (externalised by `build:pages`), like the other standalone pages.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import * as echarts from 'echarts';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { STATUS_COLORS, STATUS_LABELS, type ProductionOrder } from '../types.js';

const BAR_HEIGHT_RATIO = 0.6;
const MIN_ROW_PX = 28;
const BASE_HEIGHT_PX = 80;

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR');
}

/** Minimal view of the echarts custom-series render API we rely on. */
interface RenderApi {
  value(dimensionIndex: number): number;
  coord(point: [number, number]): [number, number];
  size(dataSize: [number, number]): [number, number];
  style(): object;
}

interface GanttRow {
  label: string;
  start: number;
  end: number;
  color: string;
  status: string;
}

@customElement('po-gantt')
export class PoGantt extends LitElement {
  static override readonly styles = [IXCoreStyles, ganttStyles()];

  @property({ attribute: false }) orders: ProductionOrder[] = [];

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  override render(): TemplateResult {
    const hasData = this.rows().length > 0;
    return html`
      ${hasData
        ? html`<div class="chart" id="chart"></div>`
        : html`<div class="empty">
            <ix-typography>Aucun ordre planifié (renseignez les dates « début/fin prévue »).</ix-typography>
          </div>`}
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  protected override updated(_changed: PropertyValues): void {
    this.renderChart();
  }

  private renderChart(): void {
    const host = this.renderRoot.querySelector<HTMLElement>('#chart');
    const rows = this.rows();
    if (!host || rows.length === 0) {
      this.resizeObserver?.disconnect();
      this.chart?.dispose();
      this.chart = null;
      return;
    }
    // Size the host to fit all rows.
    host.style.height = `${BASE_HEIGHT_PX + rows.length * MIN_ROW_PX}px`;
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
    this.chart.setOption(this.chartOption(rows), true);
  }

  private chartOption(rows: GanttRow[]): echarts.EChartsCoreOption {
    const text = this.cssVar('--theme-color-std-text', '#e8e8e8');
    const grid = this.cssVar('--theme-color-soft-bdr', '#444');
    const categories = rows.map((r) => r.label);
    const data = rows.map((r, i) => ({
      value: [i, r.start, r.end],
      itemStyle: { color: r.color },
      name: r.status
    }));
    return {
      backgroundColor: 'transparent',
      textStyle: { color: text },
      tooltip: {
        formatter: (p: { name: string; value: [number, number, number] }): string => {
          const [, start, end] = p.value;
          return `${categories[p.value[0]]}<br/>${p.name}<br/>${fmtDateTime(start)} → ${fmtDateTime(end)}`;
        }
      },
      grid: { left: 8, right: 24, top: 24, bottom: 24, containLabel: true },
      xAxis: {
        type: 'time',
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: grid } }
      },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: true,
        axisLabel: { color: text },
        axisLine: { lineStyle: { color: grid } }
      },
      series: [
        {
          type: 'custom',
          renderItem: this.renderItem.bind(this),
          encode: { x: [1, 2], y: 0 },
          data
        }
      ]
    };
  }

  private renderItem(_params: unknown, api: RenderApi): object | undefined {
    const categoryIndex = api.value(0);
    const start = api.coord([api.value(1), categoryIndex]);
    const end = api.coord([api.value(2), categoryIndex]);
    const height = api.size([0, 1])[1] * BAR_HEIGHT_RATIO;
    const width = Math.max(2, end[0] - start[0]);
    return {
      type: 'rect',
      shape: {
        x: start[0],
        y: start[1] - height / 2,
        width,
        height,
        r: 3
      },
      style: api.style()
    };
  }

  private rows(): GanttRow[] {
    const out: GanttRow[] = [];
    for (const order of this.orders) {
      const start = new Date(order.plannedStart).getTime();
      const end = new Date(order.plannedEnd).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      out.push({
        label: `${order.orderNo} · ${order.product}`.slice(0, 38),
        start,
        end,
        color: STATUS_COLORS[order.status],
        status: STATUS_LABELS[order.status]
      });
    }
    return out;
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }
}

function ganttStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      width: 100%;
      overflow: auto;
    }
    .chart {
      width: 100%;
      min-height: 8rem;
    }
    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 8rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
