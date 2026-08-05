// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fleet KPI strip — one tile per aggregate (size, moving, available, charging,
 * faults, average battery, missions, utilization). Display only; the figures come
 * from {@link fleetMetrics} over the live vehicle list.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fleetMetrics } from '../data/metrics.js';
import { MSG, localizeDir } from '../i18n.js';
import { STATE_COLORS, batteryLevel, type Agv } from '../types.js';

/** One tile: label (a reactive `localizeDir` result), formatted value and the theme token colouring it. */
interface Tile {
  label: unknown;
  value: string;
  color?: string;
}

const ONE_DECIMAL = 1;

@customElement('af-kpi-bar')
export class AfKpiBar extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) fleet: Agv[] = [];

  override render(): TemplateResult {
    return html`<div class="kpis">
      ${this.tiles().map((tile) => this.renderTile(tile))}
    </div>`;
  }

  private tiles(): Tile[] {
    const m = fleetMetrics(this.fleet);
    const batteryColor = {
      ok: 'var(--theme-color-success)',
      low: 'var(--theme-color-warning)',
      critical: 'var(--theme-color-alarm)'
    };
    return [
      { label: localizeDir(MSG.kpi.fleetSize), value: String(m.total) },
      {
        label: localizeDir(MSG.kpi.moving),
        value: String(m.moving),
        color: STATE_COLORS.moving
      },
      {
        label: localizeDir(MSG.kpi.available),
        value: String(m.available),
        color: STATE_COLORS.idle
      },
      {
        label: localizeDir(MSG.kpi.charging),
        value: String(m.charging),
        color: STATE_COLORS.charging
      },
      {
        label: localizeDir(MSG.kpi.faulted),
        value: String(m.faulted),
        color: m.faulted > 0 ? STATE_COLORS.error : undefined
      },
      {
        label: localizeDir(MSG.kpi.avgBattery),
        value: `${m.avgBattery.toFixed(ONE_DECIMAL)} %`,
        color: batteryColor[batteryLevel(m.avgBattery)]
      },
      {
        label: localizeDir(MSG.kpi.utilization),
        value: `${m.utilization.toFixed(0)} %`
      },
      {
        label: localizeDir(MSG.kpi.missionsToday),
        value: String(m.missionsToday)
      }
    ];
  }

  private renderTile(tile: Tile): TemplateResult {
    return html`
      <div
        class="tile"
        style="--tile-color: ${tile.color ?? 'var(--theme-color-std-text)'}"
      >
        <span class="value">${tile.value}</span>
        <span class="label">${tile.label}</span>
      </div>
    `;
  }
}

function kpiStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
      gap: 0.5rem;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding: 0.5rem 0.75rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 3px solid var(--tile-color);
      border-radius: var(--theme-default-border-radius);
    }
    .value {
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 1.1;
      color: var(--tile-color);
      font-variant-numeric: tabular-nums;
    }
    .label {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
}
