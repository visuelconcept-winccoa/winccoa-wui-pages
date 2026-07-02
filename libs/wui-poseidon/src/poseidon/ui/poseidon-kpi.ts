// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * KPI dashboard: live headline tiles, removal efficiencies, discharge-conformity
 * verdicts (vs the regulatory limits) and specific energy — all derived from the
 * shared sensor snapshot so it stays in step with the other tabs.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { DISCHARGE_LIMITS, sensorByPath } from '../model.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { fmt, removal } from '../format.js';
import type { SensorValues } from '../types.js';

interface Tile {
  label: string;
  value: string;
  unit: string;
}

export class PoseidonKpi extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) sensors: SensorValues = {};

  private get tiles(): Tile[] {
    const s = this.sensors;
    const specificEnergy = s['outlet.flow'] > 0 ? s['energy.power'] / s['outlet.flow'] : 0;
    return [
      { label: localize(sensorByPath('inlet.flow')?.label ?? MSG.kpi.value), value: fmt(s['inlet.flow'], 0), unit: 'm³/h' },
      { label: localize(sensorByPath('outlet.flow')?.label ?? MSG.kpi.value), value: fmt(s['outlet.flow'], 0), unit: 'm³/h' },
      { label: localize(sensorByPath('bio.do')?.label ?? MSG.kpi.value), value: fmt(s['bio.do'], 2), unit: 'mg/L' },
      { label: localize(MSG.kpi.specificEnergy), value: fmt(specificEnergy, 3), unit: 'kWh/m³' },
      { label: localize(sensorByPath('energy.power')?.label ?? MSG.kpi.value), value: fmt(s['energy.power'], 1), unit: 'kW' },
      { label: localize(sensorByPath('energy.energyToday')?.label ?? MSG.kpi.value), value: fmt(s['energy.energyToday'], 0), unit: 'kWh' }
    ];
  }

  private get efficiencies(): { label: string; percent: number }[] {
    const s = this.sensors;
    return [
      { label: localize(sensorByPath('inlet.cod')?.label ?? ''), percent: removal(s['inlet.cod'], s['outlet.cod']) },
      { label: localize(sensorByPath('inlet.tss')?.label ?? ''), percent: removal(s['inlet.tss'], s['outlet.tss']) },
      { label: localize(sensorByPath('inlet.nh4')?.label ?? ''), percent: removal(s['inlet.nh4'], s['outlet.nh4']) }
    ];
  }

  override render(): TemplateResult {
    return html`
      <section class="kpi">
        <h3>${localizeDir(MSG.kpi.title)}</h3>

        <div class="tiles">
          ${this.tiles.map(
            (t) => html`<div class="tile">
              <div class="tile-value">${t.value} <span class="unit">${t.unit}</span></div>
              <div class="tile-label">${t.label}</div>
            </div>`
          )}
        </div>

        <div class="cols">
          <div class="panel">
            <h4>${localizeDir(MSG.kpi.efficiency)}</h4>
            ${this.efficiencies.map(
              (e) => html`<div class="bar-row">
                <span class="bar-label">${e.label}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${e.percent.toFixed(0)}%"></div></div>
                <span class="bar-val">${e.percent.toFixed(0)} %</span>
              </div>`
            )}
          </div>

          <div class="panel">
            <h4>${localizeDir(MSG.kpi.conformity)}</h4>
            <table>
              <thead>
                <tr>
                  <th>${localizeDir(MSG.kpi.parameter)}</th>
                  <th>${localizeDir(MSG.kpi.value)}</th>
                  <th>${localizeDir(MSG.kpi.limit)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${DISCHARGE_LIMITS.map((t) => this.conformityRow(t))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private conformityRow(t: (typeof DISCHARGE_LIMITS)[number]): TemplateResult {
    const value = this.sensors[t.path];
    const pass =
      value == null
        ? true
        : t.kind === 'max'
          ? t.max == null || value <= t.max
          : (t.min == null || value >= t.min) && (t.max == null || value <= t.max);
    const limit = t.kind === 'max' ? `≤ ${t.max}` : `${t.min}–${t.max}`;
    const u = t.unit ? ` ${t.unit}` : '';
    return html`<tr>
      <td>${localize(t.label)}</td>
      <td>${fmt(value, 1)}${u}</td>
      <td>${limit}${u}</td>
      <td>
        <ix-pill variant=${pass ? 'success' : 'alarm'}>
          ${pass ? localizeDir(MSG.kpi.compliant) : localizeDir(MSG.kpi.nonCompliant)}
        </ix-pill>
      </td>
    </tr>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function kpiStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    h3,
    h4 {
      margin: 0;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.6rem;
    }
    .tile {
      padding: 0.8rem 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 6px;
      background: var(--theme-color-1);
    }
    .tile-value {
      font-size: 1.6rem;
      font-weight: 600;
      color: var(--theme-color-text);
    }
    .tile-value .unit {
      font-size: 0.8rem;
      font-weight: 400;
      opacity: 0.7;
    }
    .tile-label {
      font-size: 0.8rem;
      opacity: 0.75;
      margin-top: 0.2rem;
    }
    .cols {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
    }
    .panel {
      padding: 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 6px;
      background: var(--theme-color-1);
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 5rem 1fr 3rem;
      align-items: center;
      gap: 0.6rem;
    }
    .bar-track {
      height: 0.7rem;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.2);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--theme-color-primary, #00b3b3);
    }
    .bar-val {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 0.3rem 0.4rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-variant-numeric: tabular-nums;
    }
    th {
      font-weight: 600;
      opacity: 0.8;
    }
  `;
}

if (!customElements.get('poseidon-kpi')) {
  customElements.define('poseidon-kpi', PoseidonKpi);
}
