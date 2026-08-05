// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Detail card of the selected vehicle — state, charge, current mission and the
 * runtime figures, plus the fault text when the vehicle is faulted or offline.
 * Read-only: supervision only, the page never commands a vehicle.
 *
 * Emits: `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir, stateLabel } from '../i18n.js';
import {
  STATE_COLORS,
  STATE_ICONS,
  batteryIcon,
  batteryLevel,
  clampPercent,
  type Agv
} from '../types.js';

const ONE_DECIMAL = 1;
const TWO_DECIMALS = 2;

@customElement('af-detail')
export class AfDetail extends LitElement {
  static override readonly styles = [IXCoreStyles, detailStyles()];

  @property({ attribute: false }) agv!: Agv;

  override render(): TemplateResult {
    const agv = this.agv;
    return html`
      <div class="card" style="--state-color: ${STATE_COLORS[agv.state]}">
        <div class="head">
          <ix-icon name=${STATE_ICONS[agv.state]} size="24"></ix-icon>
          <div class="titles">
            <div class="name">${agv.name || agv.id}</div>
            <div class="sub">${agv.model} · ${stateLabel(agv.state)}</div>
          </div>
          <ix-icon-button
            ghost
            size="16"
            icon="close"
            title=${localize(MSG.detail.close)}
            @click=${this.requestClose}
          ></ix-icon-button>
        </div>

        ${
          agv.errorText
            ? html`<div class="fault">
                <ix-icon name="warning" size="16"></ix-icon>
                <span
                  ><strong>${localizeDir(MSG.detail.fault)}:</strong>
                  ${agv.errorText}</span
                >
              </div>`
            : nothing
        }

        <div class="charge ${batteryLevel(agv.battery)}">
          <ix-icon name=${batteryIcon(agv.battery)} size="16"></ix-icon>
          <div class="gauge">
            <div
              class="fill"
              style="width: ${clampPercent(agv.battery)}%"
            ></div>
          </div>
          <span class="pct mono">${agv.battery.toFixed(ONE_DECIMAL)} %</span>
        </div>

        <div class="mission">
          <span class="label">${localizeDir(MSG.table.mission)}</span>
          <span class=${agv.mission ? 'value' : 'value muted'}
            >${agv.mission || localizeDir(MSG.table.noMission)}</span
          >
        </div>

        ${this.renderFacts(agv)}
      </div>
    `;
  }

  private renderFacts(agv: Agv): TemplateResult {
    const position = `${agv.posX.toFixed(ONE_DECIMAL)} / ${agv.posY.toFixed(ONE_DECIMAL)} m`;
    return html`
      <dl class="facts">
        ${this.fact(localizeDir(MSG.detail.datapoint), agv.dp, true)}
        ${this.fact(localizeDir(MSG.table.zone), agv.zone || '—')}
        ${this.fact(localizeDir(MSG.table.speed), `${agv.speed.toFixed(TWO_DECIMALS)} m/s`, true)}
        ${this.fact(localizeDir(MSG.detail.heading), `${agv.heading.toFixed(0)}°`, true)}
        ${this.fact(localizeDir(MSG.detail.position), position, true)}
        ${this.fact(localizeDir(MSG.detail.payload), agv.payload || localize(MSG.detail.noPayload))}
        ${this.fact(localizeDir(MSG.detail.odometer), `${agv.odometer.toFixed(ONE_DECIMAL)} km`, true)}
        ${this.fact(localizeDir(MSG.detail.missionsToday), String(agv.missionsToday), true)}
      </dl>
    `;
  }

  private fact(label: unknown, value: string, mono = false): TemplateResult {
    return html`
      <dt>${label}</dt>
      <dd class=${mono ? 'mono' : ''}>${value}</dd>
    `;
  }

  private requestClose(): void {
    this.dispatchEvent(
      new CustomEvent('wui:close', { bubbles: true, composed: true })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function detailStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-top: 3px solid var(--state-color);
      border-radius: var(--theme-default-border-radius);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--state-color);
    }
    .titles {
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: 1rem;
      font-weight: 600;
      color: var(--theme-color-std-text);
    }
    .sub {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .fault {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.5rem 0.625rem;
      border: 1px solid var(--theme-color-alarm);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 12%, transparent);
      font-size: 0.8125rem;
    }
    .charge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      --bat-color: var(--theme-color-success);
      color: var(--bat-color);
    }
    .charge.low {
      --bat-color: var(--theme-color-warning);
    }
    .charge.critical {
      --bat-color: var(--theme-color-alarm);
    }
    .gauge {
      flex: 1;
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
      font-size: 0.8125rem;
      white-space: nowrap;
    }
    .mission {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      font-size: 0.8125rem;
    }
    .mission .label {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
    }
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 0.75rem;
      margin: 0;
      font-size: 0.8125rem;
    }
    dt {
      color: var(--theme-color-soft-text);
      white-space: nowrap;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-family-mono, monospace);
      font-variant-numeric: tabular-nums;
    }
  `;
}
