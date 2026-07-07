// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Summary KPI strip for the production-order list: total count, a per-status
 * breakdown (À venir / En cours / Terminé), and a "late" count (not finished
 * but past its planned end).
 *
 * The indicators are computed server-side by the `productionOrdersKpi` JavaScript
 * manager and published on the `ProductionOrders_Kpi` datapoint; this strip binds
 * to them live (dpConnect). When the backend is unreachable (offline mode), it
 * transparently falls back to computing the same figures from the `.orders`
 * property in the browser.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { STATUS_COLORS, type OrderStatus, type ProductionOrder } from '../types.js';
import { MSG, localizeDir } from '../i18n.js';

const LATE_COLOR = '#ef4444';
const KPI_DP = 'ProductionOrders_Kpi';
/** Element fields bound from the manager datapoint. */
const KPI_FIELDS = ['total', 'planned', 'running', 'paused', 'done', 'late'] as const;

interface DpEmission {
  dp: string[];
  value: unknown[];
}

interface Kpi {
  value: number;
  label: MultiLangString;
  color?: string;
}

@customElement('po-kpi-bar')
export class PoKpiBar extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) orders: ProductionOrder[] = [];

  /** Live values from the manager DP; null until the first emission. */
  @state() private live: Record<string, number> | null = null;

  private readonly api = this.resolveApi();
  private sub = new Subscription();
  private subscribed = false;

  override render(): TemplateResult {
    const counts = this.counts();
    const kpis: Kpi[] = [
      { value: counts.total, label: MSG.kpi.orders },
      { value: counts.planned, label: MSG.kpi.upcoming, color: STATUS_COLORS.planned },
      { value: counts.running, label: MSG.kpi.running, color: STATUS_COLORS.running },
      { value: counts.done, label: MSG.kpi.done, color: STATUS_COLORS.done },
      { value: counts.late, label: MSG.kpi.late, color: LATE_COLOR }
    ];
    return html`
      <div class="bar">
        ${kpis.map(
          (kpi) => html`
            <div class="kpi" style=${kpi.color ? `--c:${kpi.color}` : ''}>
              <span class="value">${kpi.value}</span>
              <span class="label">${localizeDir(kpi.label)}</span>
            </div>
          `
        )}
      </div>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.subscribe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.sub.unsubscribe();
    this.sub = new Subscription();
    this.subscribed = false;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this.subscribe();
  }

  /** Indicators to display: manager values when live, else local fallback. */
  private counts(): { total: number; planned: number; running: number; done: number; late: number } {
    if (this.live) {
      return {
        total: this.live['total'] ?? 0,
        planned: this.live['planned'] ?? 0,
        running: (this.live['running'] ?? 0) + (this.live['paused'] ?? 0),
        done: this.live['done'] ?? 0,
        late: this.live['late'] ?? 0
      };
    }
    return this.localCounts();
  }

  private localCounts(): { total: number; planned: number; running: number; done: number; late: number } {
    const c: Record<OrderStatus, number> = {
      planned: 0,
      running: 0,
      paused: 0,
      done: 0,
      cancelled: 0
    };
    const now = Date.now();
    let late = 0;
    for (const order of this.orders) {
      c[order.status] += 1;
      if (this.isLate(order, now)) late += 1;
    }
    return {
      total: this.orders.length,
      planned: c.planned,
      running: c.running + c.paused,
      done: c.done,
      late
    };
  }

  private isLate(order: ProductionOrder, now: number): boolean {
    if (order.status === 'done' || order.status === 'cancelled') return false;
    if (order.plannedEnd === '') return false;
    const end = new Date(order.plannedEnd).getTime();
    return Number.isFinite(end) && end < now;
  }

  private subscribe(): void {
    if (this.subscribed) return;
    const api = this.api;
    if (!api) return;
    const dps = KPI_FIELDS.map((f) => `${KPI_DP}.${f}`);
    try {
      this.sub.add(
        api.dpConnect(dps, true).subscribe({
          next: (data: DpEmission) => this.onEmission(data),
          error: () => {
            // Live channel dropped — keep the local fallback.
          }
        })
      );
      this.subscribed = true;
    } catch {
      // Backend not connected — keep the local fallback.
    }
  }

  private onEmission(data: DpEmission): void {
    const next: Record<string, number> = { ...this.live };
    for (const [i, dp] of data.dp.entries()) {
      const field = this.fieldOf(dp);
      if ((KPI_FIELDS as readonly string[]).includes(field)) {
        next[field] = this.toNumber(data.value[i]);
      }
    }
    this.live = next;
  }

  /** Element name from a (server-normalized) dpConnect dp string. */
  private fieldOf(dp: string): string {
    let s = dp.replace(/^[^:]+:/, '');
    const cfg = s.indexOf(':');
    if (cfg !== -1) s = s.slice(0, cfg);
    s = s.replace(/\.$/, '');
    return s.slice(s.lastIndexOf('.') + 1);
  }

  private toNumber(raw: unknown): number {
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

function kpiStyles(): ReturnType<typeof css> {
  return css`
    .bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.75rem 0;
    }
    .kpi {
      flex: 1 1 0;
      min-width: 6rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.75rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-top: 3px solid var(--c, var(--theme-color-soft-bdr));
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--c, var(--theme-color-std-text));
    }
    .label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
