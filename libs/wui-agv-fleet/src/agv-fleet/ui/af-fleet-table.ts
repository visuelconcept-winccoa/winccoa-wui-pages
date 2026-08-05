// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sortable status list of the fleet: vehicle, state chip, charge bar, speed,
 * zone and current mission. A row selects the vehicle (highlighting it on the
 * floor plan and opening the detail panel).
 *
 * Emits: `wui:select` (`{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, stateLabel } from '../i18n.js';
import {
  STATE_COLORS,
  STATE_ICONS,
  batteryLevel,
  clampPercent,
  type Agv
} from '../types.js';

type SortKey = 'name' | 'state' | 'battery' | 'zone' | 'missionsToday';

const ONE_DECIMAL = 1;
const TWO_DECIMALS = 2;

@customElement('af-fleet-table')
export class AfFleetTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) fleet: Agv[] = [];
  /** Id of the selected vehicle, empty when none. */
  @property() selected = '';

  @state() private sortKey: SortKey = 'name';
  @state() private sortAsc = true;

  override render(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            ${this.header(localize(MSG.table.vehicle), 'name')}
            ${this.header(localize(MSG.table.state), 'state')}
            ${this.header(localize(MSG.table.battery), 'battery')}
            <th class="num">${localizeDir(MSG.table.speed)}</th>
            ${this.header(localize(MSG.table.zone), 'zone')}
            <th>${localizeDir(MSG.table.mission)}</th>
            ${this.header(localize(MSG.table.missions), 'missionsToday')}
          </tr>
        </thead>
        <tbody>
          ${this.sorted().map((agv) => this.renderRow(agv))}
        </tbody>
      </table>
    `;
  }

  private renderRow(agv: Agv): TemplateResult {
    return html`
      <tr
        class="clickable ${agv.id === this.selected ? 'selected' : ''}"
        style="--state-color: ${STATE_COLORS[agv.state]}"
        @click=${() => this.requestSelect(agv.id)}
      >
        <td>
          <div class="strong">${agv.name || agv.id}</div>
          <div class="muted mono">${agv.dp}</div>
        </td>
        <td>
          <span class="chip">
            <ix-icon name=${STATE_ICONS[agv.state]} size="12"></ix-icon
            >${stateLabel(agv.state)}
          </span>
        </td>
        <td class="battery-cell">${this.renderBattery(agv.battery)}</td>
        <td class="num mono">${agv.speed.toFixed(TWO_DECIMALS)} m/s</td>
        <td>${agv.zone || '—'}</td>
        <td class="mission">
          ${
            agv.errorText
              ? html`<span class="fault"
                  ><ix-icon name="warning" size="12"></ix-icon
                  >${agv.errorText}</span
                >`
              : html`<span class=${agv.mission ? '' : 'muted'}
                  >${agv.mission || localizeDir(MSG.table.noMission)}</span
                >`
          }
        </td>
        <td class="num mono">${agv.missionsToday}</td>
      </tr>
    `;
  }

  private renderBattery(battery: number): TemplateResult {
    return html`
      <div class="battery ${batteryLevel(battery)}">
        <div class="gauge">
          <div class="fill" style="width: ${clampPercent(battery)}%"></div>
        </div>
        <span class="mono pct">${battery.toFixed(ONE_DECIMAL)} %</span>
      </div>
    `;
  }

  private header(label: string, key: SortKey): TemplateResult {
    const active = this.sortKey === key;
    return html`
      <th
        class="sortable ${active ? 'active' : ''}"
        title=${localize(MSG.table.sortBy)}
        @click=${() => this.sortOn(key)}
      >
        ${label}${active ? html`<span class="caret">${this.sortAsc ? '▲' : '▼'}</span>` : ''}
      </th>
    `;
  }

  private sortOn(key: SortKey): void {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else {
      this.sortKey = key;
      this.sortAsc = true;
    }
  }

  private sorted(): Agv[] {
    const key = this.sortKey;
    const direction = this.sortAsc ? 1 : -1;
    return [...this.fleet].sort((a, b) => {
      const left = key === 'name' ? a.name || a.id : a[key];
      const right = key === 'name' ? b.name || b.id : b[key];
      if (typeof left === 'number' && typeof right === 'number')
        return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
  }

  private requestSelect(id: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:select', {
        detail: { id },
        bubbles: true,
        composed: true
      })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function tableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      text-align: left;
      padding: 0.375rem 0.5rem;
      background: var(--theme-color-2);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    th.sortable:hover,
    th.active {
      color: var(--theme-color-std-text);
    }
    .caret {
      margin-left: 0.25rem;
      font-size: 0.625rem;
    }
    tbody td {
      padding: 0.375rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tr.clickable {
      cursor: pointer;
      border-left: 3px solid var(--state-color);
    }
    tr.clickable:hover td {
      background: var(--theme-color-3);
    }
    tr.selected td {
      background: color-mix(
        in srgb,
        var(--theme-color-primary) 16%,
        transparent
      );
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
    }
    .mono {
      font-family: var(--theme-font-family-mono, monospace);
      font-variant-numeric: tabular-nums;
    }
    .num {
      text-align: right;
      white-space: nowrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.0625rem 0.5rem;
      border-radius: 1rem;
      white-space: nowrap;
      color: var(--state-color);
      border: 1px solid var(--state-color);
      background: color-mix(in srgb, var(--state-color) 14%, transparent);
    }
    .battery-cell {
      min-width: 8rem;
    }
    .battery {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      --bat-color: var(--theme-color-success);
    }
    .battery.low {
      --bat-color: var(--theme-color-warning);
    }
    .battery.critical {
      --bat-color: var(--theme-color-alarm);
    }
    .gauge {
      flex: 1;
      min-width: 3rem;
      height: 0.5rem;
      border-radius: 0.25rem;
      overflow: hidden;
      background: var(--theme-color-component-1);
    }
    .fill {
      height: 100%;
      background: var(--bat-color);
      transition: width 0.4s ease;
    }
    .pct {
      color: var(--bat-color);
      font-size: 0.8125rem;
      white-space: nowrap;
    }
    .mission {
      max-width: 22rem;
    }
    .fault {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--theme-color-alarm);
    }
  `;
}
